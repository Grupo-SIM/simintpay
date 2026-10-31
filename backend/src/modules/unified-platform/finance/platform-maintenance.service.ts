import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { FinancePlatformContext } from './platform-finance.service';
import { computeBosqueAvailableSinceLastWithdrawal } from '../../../application/helpers/bosque-available.helper';

export type WalletCorrection = {
  balance?: Prisma.Decimal.Value;
  delta?: Prisma.Decimal.Value;
  lockedBalance?: Prisma.Decimal.Value;
  clampNegativeBalance?: boolean;
  reason?: string;
  action?: string;
  source?: string;
  metadata?: Prisma.InputJsonObject;
};

@Injectable()
export class PlatformMaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  private async exclusive(
    tx: Prisma.TransactionClient,
    userId: string,
    tag: string,
    context?: FinancePlatformContext,
  ) {
    const platforms = await tx.platform.findMany({
      where: { ownerUserId: userId },
      include: { owner: true },
    });
    if (platforms.length !== 1 || platforms[0].tag !== tag)
      throw new UnprocessableEntityException({
        code: 'SHARED_WALLET_MAINTENANCE_FORBIDDEN',
        message: 'Carteira sem vínculo exclusivo; manutenção bloqueada',
      });
    const platform = platforms[0];
    if (
      !platform.isActive ||
      !platform.owner.isActive ||
      platform.owner.isPurged ||
      (context && platform.id !== context.id)
    )
      throw new ForbiddenException('Plataforma ou dono alterado/inativo');
    // Serialize ownership/configuration changes with this financial operation.
    await tx.platform.update({
      where: { id: platform.id, ownerUserId: userId },
      data: { updatedAt: platform.updatedAt },
    });
  }

  async correct(
    userId: string,
    tag: string,
    input: WalletCorrection,
    context?: FinancePlatformContext,
  ) {
    if (input.balance != null && input.delta != null)
      throw new BadRequestException('Use balance ou delta');
    const parse = (value: Prisma.Decimal.Value) => {
      let amount: Prisma.Decimal;
      try {
        amount = new Prisma.Decimal(value);
      } catch {
        throw new BadRequestException('Valor monetário inválido');
      }
      if (!amount.isFinite())
        throw new BadRequestException('Valor monetário inválido');
      return amount.toDecimalPlaces(2);
    };
    return this.prisma.$transaction(
      async (tx) => {
        await this.exclusive(tx, userId, tag, context);
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new BadRequestException('Carteira não encontrada');
        const balanceBefore = new Prisma.Decimal(wallet.balance),
          lockedBefore = new Prisma.Decimal(wallet.lockedBalance);
        const computedBalance =
          input.balance != null
            ? parse(input.balance)
            : input.delta != null
              ? balanceBefore.plus(parse(input.delta))
              : balanceBefore;
        const balanceAfter = input.clampNegativeBalance
          ? Prisma.Decimal.max(0, computedBalance)
          : computedBalance;
        const lockedAfter =
          input.lockedBalance != null
            ? parse(input.lockedBalance)
            : lockedBefore;
        if (balanceAfter.isNegative() || lockedAfter.isNegative())
          throw new BadRequestException('Saldo não pode ser negativo');
        const changed =
          !balanceAfter.eq(balanceBefore) || !lockedAfter.eq(lockedBefore);
        if (changed) {
          const result = await tx.wallet.updateMany({
            where: { id: wallet.id, version: wallet.version },
            data: {
              balance: balanceAfter,
              lockedBalance: lockedAfter,
              version: { increment: 1 },
            },
          });
          if (result.count !== 1)
            throw new ConflictException('Carteira alterada; tente novamente');
          await tx.balanceLog.create({
            data: {
              userId,
              action: input.action ?? 'ADMIN_BALANCE_FIX',
              balanceDelta: balanceAfter.minus(balanceBefore),
              lockedDelta: lockedAfter.minus(lockedBefore),
              source: input.source ?? 'MASTER_ADMIN_CONTROL',
              description:
                input.reason ?? 'Correção administrativa de carteira',
              metadata: { ...input.metadata, platform: tag.toLowerCase() },
            },
          });
        }
        return {
          userId,
          changed,
          balanceBefore: balanceBefore.toNumber(),
          lockedBefore: lockedBefore.toNumber(),
          balanceAfter: balanceAfter.toNumber(),
          lockedAfter: lockedAfter.toNumber(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async baseline(
    userId: string,
    tag: string,
    amount: number,
    pixKey: string,
    reason: string,
    context?: FinancePlatformContext,
  ) {
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('Valor monetário inválido');
    return this.prisma.$transaction(
      async (tx) => {
        await this.exclusive(tx, userId, tag, context);
        if (tag !== 'BOSQUE')
          throw new UnprocessableEntityException({
            code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
            capability: 'maintenance.baseline',
          });
        const availableBefore = await computeBosqueAvailableSinceLastWithdrawal(
          tx as PrismaService,
          [userId],
        );
        const actualAmount = new Prisma.Decimal(
          Math.min(amount, availableBefore),
        )
          .toDecimalPlaces(2)
          .toNumber();
        const availableAfter = new Prisma.Decimal(availableBefore)
          .minus(actualAmount)
          .toNumber();
        if (actualAmount <= 0)
          return { id: null, actualAmount: 0, availableBefore, availableAfter };
        const created = await tx.withdrawRequest.create({
          data: {
            userId,
            amount: actualAmount,
            grossAmount: actualAmount,
            fee: 0,
            status: 'COMPLETED',
            pixKey,
            platform: `${tag.toLowerCase()}-baseline`,
          },
        });
        await tx.balanceLog.create({
          data: {
            userId,
            action: `${tag}_BASELINE_ZERO`,
            bookkeepingAmount: new Prisma.Decimal(actualAmount).neg(),
            balanceDelta: 0,
            lockedDelta: 0,
            source: 'MASTER_ADMIN_CONTROL',
            description: reason,
            metadata: {
              platform: tag.toLowerCase(),
              via: 'internal/bosque/finance/zerar-disponivel',
              valorZerado: actualAmount,
              baselineId: created.id,
            },
          },
        });
        return { ...created, actualAmount, availableBefore, availableAfter };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async run(
    context: FinancePlatformContext,
    operation: string,
    body: Record<string, unknown>,
  ) {
    if (
      !['zero-wallet', 'set-balance', 'adjust-balance', 'baseline'].includes(
        operation,
      )
    )
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: `maintenance.${operation}`,
      });
    const allowed =
      operation === 'zero-wallet'
        ? ['reason']
        : operation === 'baseline'
          ? ['amountCents', 'reason']
          : operation === 'adjust-balance'
            ? ['deltaCents', 'lockedBalanceCents', 'reason']
            : ['balanceCents', 'lockedBalanceCents', 'reason'];
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))
    )
      throw new BadRequestException('Contrato de manutenção inválido');
    if (typeof body.reason !== 'string' || !body.reason.trim())
      throw new BadRequestException('reason obrigatório');
    const cents = (value: unknown) => {
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0
      )
        throw new BadRequestException(
          'Valor deve ser centavos inteiros não negativos',
        );
      return new Prisma.Decimal(value).div(100);
    };
    const toCents = (value: number) => {
      const result = new Prisma.Decimal(value)
        .mul(100)
        .toDecimalPlaces(0)
        .toNumber();
      if (!Number.isSafeInteger(result))
        throw new BadRequestException('Valor fora do limite');
      return result;
    };
    if (operation === 'baseline') {
      if (context.tag !== 'BOSQUE')
        throw new UnprocessableEntityException({
          code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
          capability: 'maintenance.baseline',
        });
      const amount = cents(body.amountCents);
      if (amount.lte(0))
        throw new BadRequestException('amountCents deve ser positivo');
      const result = await this.baseline(
        context.ownerUserId,
        context.tag,
        amount.toNumber(),
        'BASELINE_SALDO',
        body.reason,
        context,
      );
      return {
        success: true,
        unit: 'cents',
        baselineWithdrawId: result.id,
        beforeAvailableCents: toCents(result.availableBefore),
        appliedCents: toCents(result.actualAmount),
        afterAvailableCents: toCents(result.availableAfter),
      };
    }
    if (
      operation === 'adjust-balance' &&
      (typeof body.deltaCents !== 'number' ||
        !Number.isSafeInteger(body.deltaCents))
    )
      throw new BadRequestException('deltaCents deve ser inteiro');
    const result = await this.correct(
      context.ownerUserId,
      context.tag,
      operation === 'zero-wallet'
        ? { balance: 0, lockedBalance: 0, reason: body.reason }
        : {
            ...(operation === 'adjust-balance'
              ? {
                  delta: new Prisma.Decimal(body.deltaCents as number).div(100),
                }
              : { balance: cents(body.balanceCents) }),
            ...(body.lockedBalanceCents !== undefined
              ? { lockedBalance: cents(body.lockedBalanceCents) }
              : {}),
            reason: body.reason,
          },
      context,
    );
    return {
      success: true,
      unit: 'cents',
      changed: result.changed,
      before: {
        balanceCents: toCents(result.balanceBefore),
        lockedBalanceCents: toCents(result.lockedBefore),
      },
      after: {
        balanceCents: toCents(result.balanceAfter),
        lockedBalanceCents: toCents(result.lockedAfter),
      },
    };
  }
}
