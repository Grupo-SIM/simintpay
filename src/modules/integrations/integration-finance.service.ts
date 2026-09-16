import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionStatus, WithdrawStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isValidDocument } from '../../application/validators/is-document.validator';
import { ZeroGrauConfig } from '../zero-grau/zero-grau.config';

interface ProvisionMerchantInput {
  cnpj: string;
  legalName: string;
}

@Injectable()
export class IntegrationFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  assertToken(token?: string): void {
    const expected = process.env.SIM_DELIVERY_INTERNAL_TOKEN || process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) throw new BadRequestException('Token interno inválido');
  }

  private cleanCnpj(value: string): string {
    const cnpj = String(value ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14 || !isValidDocument(cnpj)) throw new BadRequestException('CNPJ inválido');
    return cnpj;
  }

  async provision(integrationKey: string, externalMerchantId: string, input: ProvisionMerchantInput) {
    const cnpj = this.cleanCnpj(input.cnpj);
    const legalName = input.legalName?.trim();
    if (!integrationKey.trim() || !externalMerchantId.trim() || !legalName) {
      throw new BadRequestException('Integração, merchant externo e razão social são obrigatórios');
    }

    const existing = await this.prisma.integrationMerchant.findUnique({
      where: { integrationKey_externalMerchantId: { integrationKey, externalMerchantId } },
    });
    if (existing) {
      const clash = await this.prisma.integrationMerchant.findUnique({
        where: { integrationKey_cnpj: { integrationKey, cnpj } },
      });
      if (clash && clash.id !== existing.id) {
        throw new ConflictException('CNPJ já vinculado a outro merchant nesta integração');
      }
      return this.prisma.$transaction(async tx => {
        await tx.user.update({ where: { id: existing.userId }, data: { cnpj, name: legalName } });
        return tx.integrationMerchant.update({
          where: { id: existing.id },
          data: { cnpj, legalName },
          select: { cnpj: true, externalMerchantId: true, id: true, integrationKey: true, legalName: true },
        });
      });
    }

    const clash = await this.prisma.integrationMerchant.findUnique({
      where: { integrationKey_cnpj: { integrationKey, cnpj } },
    });
    if (clash) throw new ConflictException('CNPJ já vinculado a outro merchant nesta integração');

    return this.prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: {
          cnpj,
          email: `${integrationKey}.${externalMerchantId}@integration.internal`,
          name: legalName,
          password: randomUUID(),
          wallet: { create: {} },
        },
      });
      return tx.integrationMerchant.create({
        data: { cnpj, externalMerchantId, integrationKey, legalName, userId: user.id },
        select: { cnpj: true, externalMerchantId: true, id: true, integrationKey: true, legalName: true },
      });
    });
  }

  async merchant(integrationKey: string, externalMerchantId: string) {
    const merchant = await this.prisma.integrationMerchant.findUnique({
      where: { integrationKey_externalMerchantId: { integrationKey, externalMerchantId } },
      include: { user: { include: { wallet: true } } },
    });
    if (!merchant?.user.wallet) throw new NotFoundException('Merchant não provisionado');
    return merchant;
  }

  quote(grossAmountCents: number) {
    if (!Number.isInteger(grossAmountCents) || grossAmountCents <= 0) {
      throw new BadRequestException('Valor bruto inválido');
    }
    const gross = grossAmountCents / 100;
    const feeCents = Math.round(ZeroGrauConfig.saque.calcularTaxa(gross) * 100);
    const netAmountCents = grossAmountCents - feeCents;
    if (netAmountCents <= 0) throw new BadRequestException('Valor insuficiente para cobrir a taxa');
    return { feeCents, grossAmountCents, netAmountCents };
  }

  async summary(integrationKey: string, externalMerchantId: string) {
    const merchant = await this.merchant(integrationKey, externalMerchantId);
    const processing = await this.prisma.withdrawRequest.aggregate({
      where: { userId: merchant.userId, status: { in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED] } },
      _count: { id: true },
      _sum: { grossAmount: true },
    });
    const active = await this.prisma.withdrawRequest.count({
      where: { userId: merchant.userId, status: WithdrawStatus.PENDING },
    });
    const wallet = merchant.user.wallet!;
    return {
      availableBalanceCents: Math.max(0, Math.round((Number(wallet.balance) - Number(wallet.lockedBalance)) * 100)),
      canRequest: active === 0,
      blockReason: active > 0 ? 'WITHDRAWAL_IN_PROGRESS' : null,
      feePolicy: {
        fixedCents: Math.round(ZeroGrauConfig.saque.taxaFixa * 100),
        percentBasisPoints: Math.round(ZeroGrauConfig.saque.taxaPercentual * 10_000),
      },
      processingCount: processing._count.id,
      processingGrossCents: Math.round(Number(processing._sum.grossAmount ?? 0) * 100),
    };
  }

  async paymentStatus(integrationKey: string, externalMerchantId: string, paymentId: string) {
    const merchant = await this.merchant(integrationKey, externalMerchantId);
    const transaction = await this.prisma.transaction.findFirst({
      where: { userId: merchant.userId, OR: [{ domPaymentId: paymentId }, { externalPaymentId: paymentId }] },
      select: { domPaymentId: true, status: true },
    });
    return transaction
      ? { paymentId: transaction.domPaymentId ?? paymentId, status: transaction.status }
      : { paymentId, status: 'NOT_FOUND' };
  }

  async requestWithdrawal(
    integrationKey: string,
    externalMerchantId: string,
    input: { grossAmountCents: number; pixKey: string; requestId: string },
  ) {
    const merchant = await this.merchant(integrationKey, externalMerchantId);
    const duplicate = await this.prisma.withdrawRequest.findUnique({
      where: { integrationRequestId: input.requestId },
    });
    if (duplicate) {
      if (duplicate.userId !== merchant.userId) throw new ConflictException('Chave idempotente pertence a outro merchant');
      return this.serializeWithdrawal(duplicate);
    }

    const quote = this.quote(input.grossAmountCents);
    const pixKey = input.pixKey?.trim();
    if (!pixKey) throw new BadRequestException('Chave Pix obrigatória');
    const active = await this.prisma.withdrawRequest.findFirst({
      where: { userId: merchant.userId, status: { in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED] } },
    });
    if (active) throw new ConflictException('Já existe saque em processamento');
    const availableCents = Math.round((Number(merchant.user.wallet!.balance) - Number(merchant.user.wallet!.lockedBalance)) * 100);
    if (quote.grossAmountCents > availableCents) throw new BadRequestException('Saldo insuficiente');

    const withdrawal = await this.prisma.$transaction(async tx => {
      const created = await tx.withdrawRequest.create({
        data: {
          amount: new Prisma.Decimal(quote.netAmountCents).div(100),
          fee: new Prisma.Decimal(quote.feeCents).div(100),
          grossAmount: new Prisma.Decimal(quote.grossAmountCents).div(100),
          integrationRequestId: input.requestId,
          pixKey,
          platform: integrationKey,
          userId: merchant.userId,
        },
      });
      await tx.wallet.update({
        where: { userId: merchant.userId },
        data: { lockedBalance: { increment: created.grossAmount }, version: { increment: 1 } },
      });
      await this.enqueueStatus(tx, merchant.id, created);
      return created;
    });
    return this.serializeWithdrawal(withdrawal);
  }

  async listWithdrawals(integrationKey: string, externalMerchantId: string, page = 1, pageSize = 10) {
    const merchant = await this.merchant(integrationKey, externalMerchantId);
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const where = { userId: merchant.userId };
    const [totalItems, items] = await Promise.all([
      this.prisma.withdrawRequest.count({ where }),
      this.prisma.withdrawRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
    ]);
    return {
      items: items.map(item => this.serializeWithdrawal(item)),
      meta: { page: safePage, pageSize: safeSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / safeSize)) },
    };
  }

  async getWithdrawal(integrationKey: string, externalMerchantId: string, withdrawalId: string) {
    const merchant = await this.merchant(integrationKey, externalMerchantId);
    const item = await this.prisma.withdrawRequest.findFirst({ where: { id: withdrawalId, userId: merchant.userId } });
    if (!item) throw new NotFoundException('Saque não encontrado');
    return this.serializeWithdrawal(item);
  }

  async reconcilePayments(integrationKey: string, externalMerchantId: string, paymentIds: string[], dryRun: boolean) {
    const merchant = await this.merchant(integrationKey, externalMerchantId);
    let skipped = 0;
    const conflicts: string[] = [];
    const candidates: Array<{ id: string; previousUserId: string; amount: Prisma.Decimal | null }> = [];
    for (const paymentId of [...new Set(paymentIds)]) {
      const transaction = await this.prisma.transaction.findFirst({
        where: { OR: [{ domPaymentId: paymentId }, { externalPaymentId: paymentId }] },
      });
      if (!transaction) { conflicts.push(paymentId); continue; }
      if (transaction.userId === merchant.userId) { skipped += 1; continue; }
      const owner = await this.prisma.integrationMerchant.findUnique({ where: { userId: transaction.userId } });
      if (owner) { conflicts.push(paymentId); continue; }
      candidates.push({
        amount: transaction.status === TransactionStatus.COMPLETED ? transaction.netAmount ?? transaction.amount : null,
        id: transaction.id,
        previousUserId: transaction.userId,
      });
    }
    const creditedCents = candidates.reduce((sum, candidate) => sum + Math.round(Number(candidate.amount ?? 0) * 100), 0);
    if (!dryRun && conflicts.length > 0) return { attributed: 0, conflicts, creditedCents: 0, dryRun, skipped };
    if (!dryRun && candidates.length > 0) {
      await this.prisma.$transaction(async tx => {
        for (const candidate of candidates) {
          await tx.transaction.update({ where: { id: candidate.id }, data: { userId: merchant.userId } });
          if (candidate.amount) {
            await tx.wallet.update({ where: { userId: candidate.previousUserId }, data: { balance: { decrement: candidate.amount }, version: { increment: 1 } } });
            await tx.wallet.update({ where: { userId: merchant.userId }, data: { balance: { increment: candidate.amount }, version: { increment: 1 } } });
          }
        }
      });
    }
    return { attributed: candidates.length, conflicts, creditedCents, dryRun, skipped };
  }

  async enqueueCurrentStatuses(): Promise<void> {
    const merchants = await this.prisma.integrationMerchant.findMany({ select: { id: true, userId: true } });
    for (const merchant of merchants) {
      const withdrawals = await this.prisma.withdrawRequest.findMany({
        where: { userId: merchant.userId },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      for (const withdrawal of withdrawals) {
        await this.prisma.integrationWebhookDelivery.upsert({
          where: { withdrawalId_status: { status: withdrawal.status, withdrawalId: withdrawal.id } },
          create: this.deliveryData(merchant.id, withdrawal),
          update: {},
        });
      }
    }
  }

  private deliveryData(merchantId: string, withdrawal: { id: string; status: WithdrawStatus; integrationRequestId: string | null; rejectionReason: string | null; updatedAt: Date }) {
    return {
      merchantId,
      payload: {
        eventId: `${withdrawal.id}:${withdrawal.status}`,
        requestId: withdrawal.integrationRequestId,
        rejectionReason: withdrawal.rejectionReason,
        status: withdrawal.status,
        updatedAt: withdrawal.updatedAt.toISOString(),
        withdrawalId: withdrawal.id,
      },
      status: withdrawal.status,
      withdrawalId: withdrawal.id,
    };
  }

  private async enqueueStatus(tx: Prisma.TransactionClient, merchantId: string, withdrawal: { id: string; status: WithdrawStatus; integrationRequestId: string | null; rejectionReason: string | null; updatedAt: Date }) {
    await tx.integrationWebhookDelivery.create({ data: this.deliveryData(merchantId, withdrawal) });
  }

  private serializeWithdrawal(item: { id: string; grossAmount: Prisma.Decimal; amount: Prisma.Decimal; fee: Prisma.Decimal; pixKey: string; status: WithdrawStatus; rejectionReason: string | null; integrationRequestId: string | null; createdAt: Date; updatedAt: Date }) {
    return {
      createdAt: item.createdAt,
      feeCents: Math.round(Number(item.fee) * 100),
      grossAmountCents: Math.round(Number(item.grossAmount) * 100),
      id: item.id,
      netAmountCents: Math.round(Number(item.amount) * 100),
      pixKey: item.pixKey,
      rejectionReason: item.rejectionReason,
      requestId: item.integrationRequestId,
      status: item.status,
      updatedAt: item.updatedAt,
    };
  }
}
