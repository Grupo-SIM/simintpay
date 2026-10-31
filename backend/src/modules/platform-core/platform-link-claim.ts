import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

export type LinkClaim = {
  paymentLinkIds?: string[];
  subscriptionLinkIds?: string[];
  retroactiveAmountCents?: number;
  serviceAccountEmail?: string;
};
/** Transfers future link ownership only. Settled ledger and order ownership stay historical. */
export class PlatformLinkClaim {
  constructor(private readonly prisma: PrismaService) {}
  async claim(tag: string, targetUserId: string, body: LinkClaim) {
    if (tag !== 'AREAFLIX')
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: 'links.claim',
      });
    const cents = body.retroactiveAmountCents ?? 0;
    if (!Number.isSafeInteger(cents) || cents < 0)
      throw new BadRequestException('retroactiveAmountCents inválido');
    if (
      ![body.paymentLinkIds, body.subscriptionLinkIds].every(
        (ids) =>
          ids === undefined ||
          (Array.isArray(ids) &&
            ids.every((id) => typeof id === 'string' && id.trim())),
      )
    )
      throw new BadRequestException('IDs de links inválidos');
    const paymentIds = [...new Set(body.paymentLinkIds ?? [])];
    const subscriptionIds = [...new Set(body.subscriptionLinkIds ?? [])];
    const logId = createHash('sha256')
      .update(`platform-claim:${tag}:${targetUserId}`)
      .digest('hex');
    return this.prisma.$transaction(
      async (p) => {
        const platform = await p.platform.findUnique({
          where: { tag },
          include: { owner: true },
        });
        if (
          !platform?.isActive ||
          !platform.owner.isActive ||
          platform.owner.isPurged ||
          platform.ownerUserId !== targetUserId
        )
          throw new ForbiddenException('Vínculo exige dono atual ativo');
        const [payments, subscriptions] = await Promise.all([
          p.paymentLink.findMany({
            where: { id: { in: paymentIds }, plataformas: { has: tag } },
            select: { id: true },
          }),
          p.subscriptionLink.findMany({
            where: {
              id: { in: subscriptionIds },
              OR: [{ platformTag: tag }, { plataformas: { has: tag } }],
            },
            select: { id: true },
          }),
        ]);
        if (
          payments.length !== paymentIds.length ||
          subscriptions.length !== subscriptionIds.length
        )
          throw new UnprocessableEntityException({
            code: 'LINK_PLATFORM_BINDING_MISSING',
          });
        let transferred = 0;
        if (
          cents > 0 &&
          !(await p.balanceLog.findFirst({
            where: { userId: targetUserId, action: 'AREAFLIX_CLAIM_TRANSFER' },
          }))
        ) {
          const binding = await p.platformIntegration.findUnique({
            where: {
              platformId_key: {
                platformId: platform.id,
                key: 'CLAIM_SOURCE_USER_ID',
              },
            },
          });
          if (!binding?.url)
            throw new UnprocessableEntityException({
              code: 'CLAIM_SOURCE_BINDING_MISSING',
            });
          const source = await p.user.findUnique({
            where: { id: binding.url },
            include: { wallet: true },
          });
          if (
            !source?.isActive ||
            source.isPurged ||
            !source.wallet ||
            source.id === targetUserId ||
            (body.serviceAccountEmail &&
              body.serviceAccountEmail.trim() !== source.email)
          )
            throw new BadRequestException('Conta de origem inválida');
          if (
            (await p.platform.count({ where: { ownerUserId: source.id } })) > 1
          )
            throw new UnprocessableEntityException({
              code: 'SHARED_WALLET_MAINTENANCE_BLOCKED',
            });
          const amount = new Prisma.Decimal(cents).div(100);
          if (
            source.wallet.balance.minus(source.wallet.lockedBalance).lt(amount)
          )
            throw new BadRequestException('Saldo de origem insuficiente');
          const target = await p.wallet.upsert({
            where: { userId: targetUserId },
            update: {},
            create: { userId: targetUserId, balance: 0, lockedBalance: 0 },
          });
          const debit = await p.wallet.updateMany({
            where: {
              id: source.wallet.id,
              version: source.wallet.version,
              balance: { gte: amount.plus(source.wallet.lockedBalance) },
            },
            data: { balance: { decrement: amount }, version: { increment: 1 } },
          });
          const credit = await p.wallet.updateMany({
            where: { id: target.id, version: target.version },
            data: { balance: { increment: amount }, version: { increment: 1 } },
          });
          if (debit.count !== 1 || credit.count !== 1)
            throw new ConflictException('Carteira alterada por outra operação');
          for (const [wallet, delta, id] of [
            [source.wallet, amount.neg(), `${logId}-source`],
            [target, amount, logId],
          ] as const) {
            await p.balanceLog.create({
              data: {
                id,
                userId: wallet.userId,
                action: 'AREAFLIX_CLAIM_TRANSFER',
                balanceDelta: new Prisma.Decimal(
                  wallet.balance.plus(delta),
                ).sub(wallet.balance),
                lockedDelta: 0,
                source: tag,
                description:
                  'Transferência por vínculo explícito de plataforma',
              },
            });
          }
          transferred = amount.toNumber();
        }
        const paymentsResult = await p.paymentLink.updateMany({
          where: {
            id: { in: paymentIds },
            plataformas: { has: tag },
            userId: { not: targetUserId },
          },
          data: { userId: targetUserId },
        });
        const subscriptionsResult = await p.subscriptionLink.updateMany({
          where: {
            id: { in: subscriptionIds },
            OR: [{ platformTag: tag }, { plataformas: { has: tag } }],
            userId: { not: targetUserId },
          },
          data: { userId: targetUserId },
        });
        return {
          claimed: true,
          targetUserId,
          transferred: {
            paymentLinks: paymentsResult.count,
            subscriptionLinks: subscriptionsResult.count,
            orders: 0,
            transactions: 0,
          },
          retroactiveTransferred: transferred,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
