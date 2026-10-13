import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WithdrawStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ReturnBetConfig } from './return-bet.config';
import {
  ReturnBetWithdrawalPolicyService,
  type ReturnBetWithdrawalPolicy,
} from './return-bet-withdrawal-policy.service';

export interface ReturnBetWithdrawalInput {
  requestId: string;
  externalUserId: string;
  name: string;
  email: string;
  document: string;
  availableBalance: number;
  amount: number;
  pixKey: string;
}

interface ReviewInput {
  actorReference?: string;
}

@Injectable()
export class ReturnBetWithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: ReturnBetWithdrawalPolicyService,
  ) {}

  async request(input: ReturnBetWithdrawalInput) {
    const policy = await this.policyService.get();
    this.validateRequest(input, policy);

    const existing = await this.prisma.withdrawRequest.findUnique({
      where: { integrationRequestId: input.requestId },
    });
    if (existing) return this.serialize(existing);

    const account = await this.ensureAccount(input);
    const fee = Number(policy.fixedWithdrawalFee.toFixed(2));
    const netAmount = Number((input.amount - fee).toFixed(2));
    if (netAmount <= 0) {
      throw new UnprocessableEntityException('Valor insuficiente para cobrir a taxa de saque.');
    }

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const repeated = await tx.withdrawRequest.findUnique({
          where: { integrationRequestId: input.requestId },
        });
        if (repeated) return repeated;

        const wallet = await tx.wallet.findUnique({ where: { userId: account.userId } });
        if (!wallet) throw new NotFoundException('Carteira técnica do Return Bet não encontrada.');

        // Serializa solicitações do mesmo cliente. Sem o bloqueio, duas transações
        // concorrentes poderiam observar a janela livre e criar dois saques.
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`,
        );

        const pending = await tx.withdrawRequest.findFirst({
          where: { userId: account.userId, status: WithdrawStatus.PENDING },
        });
        if (pending) {
          throw new ConflictException('Já existe um saque pendente para este cliente.');
        }

        const recent = await tx.withdrawRequest.findFirst({
          where: {
            userId: account.userId,
            status: {
              in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED, WithdrawStatus.COMPLETED],
            },
            createdAt: {
              gte: new Date(Date.now() - policy.withdrawalWindowDays * 24 * 60 * 60 * 1000),
            },
          },
        });
        if (recent) {
          throw new ConflictException(
            'O cliente já utilizou o saque disponível nos últimos 30 dias.',
          );
        }

        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: input.availableBalance,
            lockedBalance: input.amount,
            version: { increment: 1 },
          },
        });

        return tx.withdrawRequest.create({
          data: {
            userId: account.userId,
            amount: netAmount,
            grossAmount: input.amount,
            fee,
            pixKey: input.pixKey.trim(),
            platform: ReturnBetConfig.slug,
            status: WithdrawStatus.PENDING,
            integrationRequestId: input.requestId,
            sourceBalanceSnapshot: input.availableBalance,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const recovered = await this.prisma.withdrawRequest.findUnique({
          where: { integrationRequestId: input.requestId },
        });
        if (recovered) return this.serialize(recovered);
      }
      throw error;
    }

    return this.serialize(created);
  }

  async listStatus(requestIds: string[]) {
    const uniqueIds = [...new Set(requestIds.filter(Boolean))].slice(0, 500);
    if (uniqueIds.length === 0) return [];

    const rows = await this.prisma.withdrawRequest.findMany({
      where: { integrationRequestId: { in: uniqueIds }, platform: ReturnBetConfig.slug },
    });
    return rows.map((row) => this.serialize(row));
  }

  async approve(requestId: string, receiptImage: string, input: ReviewInput) {
    if (!receiptImage?.trim()) {
      throw new BadRequestException('Comprovante de pagamento é obrigatório.');
    }

    const withdrawal = await this.findByRequestId(requestId);
    if (
      withdrawal.status === WithdrawStatus.APPROVED ||
      withdrawal.status === WithdrawStatus.COMPLETED
    ) {
      return this.serialize(withdrawal);
    }
    if (withdrawal.status !== WithdrawStatus.PENDING) {
      throw new ConflictException(`Saque já finalizado como ${withdrawal.status}.`);
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawRequest.updateMany({
        where: { id: withdrawal.id, status: WithdrawStatus.PENDING },
        data: {
          status: WithdrawStatus.APPROVED,
          receiptImage: receiptImage.trim(),
          reviewedAt: new Date(),
          reviewSource: 'RETURN_BET_ADMIN',
          reviewedByReference: input.actorReference ?? null,
        },
      });
      if (claimed.count !== 1) throw new ConflictException('Saque alterado por outro administrador.');

      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: withdrawal.userId } });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: withdrawal.grossAmount },
          lockedBalance: { decrement: withdrawal.grossAmount },
          version: { increment: 1 },
        },
      });
      await this.createBalanceLog(tx, withdrawal, wallet, 'WITHDRAW_APPROVED');
    });

    return this.serialize(await this.findByRequestId(requestId));
  }

  async reject(requestId: string, reason: string, input: ReviewInput) {
    if (!reason?.trim()) throw new BadRequestException('Motivo da rejeição é obrigatório.');

    const withdrawal = await this.findByRequestId(requestId);
    if (withdrawal.status === WithdrawStatus.REJECTED) return this.serialize(withdrawal);
    if (withdrawal.status !== WithdrawStatus.PENDING) {
      throw new ConflictException(`Saque já finalizado como ${withdrawal.status}.`);
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawRequest.updateMany({
        where: { id: withdrawal.id, status: WithdrawStatus.PENDING },
        data: {
          status: WithdrawStatus.REJECTED,
          rejectionReason: reason.trim(),
          reviewedAt: new Date(),
          reviewSource: 'RETURN_BET_ADMIN',
          reviewedByReference: input.actorReference ?? null,
        },
      });
      if (claimed.count !== 1) throw new ConflictException('Saque alterado por outro administrador.');

      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: withdrawal.userId } });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: { decrement: withdrawal.grossAmount }, version: { increment: 1 } },
      });
      await this.createBalanceLog(tx, withdrawal, wallet, 'WITHDRAW_REJECTED');
    });

    return this.serialize(await this.findByRequestId(requestId));
  }

  private validateRequest(input: ReturnBetWithdrawalInput, policy: ReturnBetWithdrawalPolicy) {
    if (!input.requestId?.trim() || !input.externalUserId?.trim()) {
      throw new BadRequestException('Identificadores do saque são obrigatórios.');
    }
    if (!input.name?.trim() || !input.email?.trim() || !input.document?.trim()) {
      throw new BadRequestException('Dados do beneficiário são obrigatórios.');
    }
    if (!input.pixKey?.trim()) throw new BadRequestException('Chave Pix é obrigatória.');
    if (!Number.isFinite(input.amount) || input.amount < policy.minimumGrossAmount) {
      throw new UnprocessableEntityException(
        `O valor mínimo para saque é de R$ ${policy.minimumGrossAmount.toFixed(2).replace('.', ',')}.`,
      );
    }
    if (!Number.isFinite(input.availableBalance) || input.availableBalance < input.amount) {
      throw new UnprocessableEntityException('Saldo disponível insuficiente para este saque.');
    }
  }

  private async ensureAccount(input: ReturnBetWithdrawalInput) {
    const registeredPlatform = await this.prisma.platform.findFirst({
      where: { tag: { equals: ReturnBetConfig.slug, mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false } },
    });
    if (!registeredPlatform) {
      throw new UnprocessableEntityException('Plataforma Return Bet não cadastrada com dono no admin.');
    }
    const current = await this.prisma.returnBetAccount.findUnique({
      where: { externalUserId: input.externalUserId },
    });
    if (current) {
      return this.prisma.returnBetAccount.update({
        where: { id: current.id },
        data: {
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          document: input.document.replace(/\D/g, ''),
        },
      });
    }

    const password = await bcrypt.hash(randomUUID(), 12);
    const emailHash = createHash('sha256').update(input.externalUserId).digest('hex').slice(0, 24);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const platform = await tx.platform.findFirst({
          where: { tag: { equals: ReturnBetConfig.slug, mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false } },
        });
        const tenant = platform?.tenantModuleId
          ? await tx.tenantModule.findUnique({ where: { id: platform.tenantModuleId } })
          : null;
        if (!platform || !tenant?.isActive) {
          throw new UnprocessableEntityException('Plataforma Return Bet não cadastrada com dono no admin.');
        }
        const user = await tx.user.create({
          data: {
            name: input.name.trim(),
            email: `return-bet-${emailHash}@internal.simpay`,
            password,
            tenantModuleId: tenant.id,
            isActive: false,
          },
        });
        await tx.wallet.create({ data: { userId: user.id } });
        return tx.returnBetAccount.create({
          data: {
            externalUserId: input.externalUserId,
            userId: user.id,
            name: input.name.trim(),
            email: input.email.trim().toLowerCase(),
            document: input.document.replace(/\D/g, ''),
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.returnBetAccount.findUniqueOrThrow({
          where: { externalUserId: input.externalUserId },
        });
      }
      throw error;
    }
  }

  private findByRequestId(requestId: string) {
    return this.prisma.withdrawRequest.findFirstOrThrow({
      where: { integrationRequestId: requestId, platform: ReturnBetConfig.slug },
    });
  }

  private async createBalanceLog(
    tx: Prisma.TransactionClient,
    withdrawal: Awaited<ReturnType<ReturnBetWithdrawalService['findByRequestId']>>,
    wallet: { balance: Prisma.Decimal; lockedBalance: Prisma.Decimal },
    action: 'WITHDRAW_APPROVED' | 'WITHDRAW_REJECTED',
  ) {
    const approved = action === 'WITHDRAW_APPROVED';
    await tx.balanceLog.create({
      data: {
        userId: withdrawal.userId,
        action,
        amount: approved ? withdrawal.grossAmount.negated() : new Prisma.Decimal(0),
        balanceBefore: wallet.balance,
        balanceAfter: approved ? wallet.balance.minus(withdrawal.grossAmount) : wallet.balance,
        lockedBefore: wallet.lockedBalance,
        lockedAfter: wallet.lockedBalance.minus(withdrawal.grossAmount),
        source: 'RETURN_BET',
        description: approved ? 'Saque Return Bet aprovado' : 'Saque Return Bet rejeitado',
        metadata: { integrationRequestId: withdrawal.integrationRequestId },
      },
    });
  }

  private serialize(withdrawal: {
    id: string;
    integrationRequestId: string | null;
    grossAmount: Prisma.Decimal;
    amount: Prisma.Decimal;
    fee: Prisma.Decimal;
    pixKey: string;
    status: WithdrawStatus;
    receiptImage: string | null;
    rejectionReason: string | null;
    reviewedAt: Date | null;
    reviewSource: string | null;
    reviewedByReference: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: withdrawal.id,
      requestId: withdrawal.integrationRequestId,
      grossAmount: Number(withdrawal.grossAmount),
      netAmount: Number(withdrawal.amount),
      fee: Number(withdrawal.fee),
      pixKey: withdrawal.pixKey,
      status: withdrawal.status,
      receiptImage: withdrawal.receiptImage,
      rejectionReason: withdrawal.rejectionReason,
      reviewedAt: withdrawal.reviewedAt,
      reviewSource: withdrawal.reviewSource,
      reviewedByReference: withdrawal.reviewedByReference,
      createdAt: withdrawal.createdAt,
      updatedAt: withdrawal.updatedAt,
    };
  }
}
