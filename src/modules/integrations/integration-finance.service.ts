import { hasPlatformMarker } from '../platform-core/platform-sync.adapter';
import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { merchantWithdrawalDelivery } from '../platform-core/platform-merchant-delivery';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WithdrawStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isValidDocument } from '../../application/validators/is-document.validator';
import { getPlatformTaxaEffective } from '../platform-taxas/platform-taxas.store';
import { resolveLegacyMerchantPlatform } from './legacy-merchant-platform';

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

    await resolveLegacyMerchantPlatform(this.prisma, integrationKey);
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
        const cnpjOwner = await tx.user.findUnique({ where: { cnpj }, select: { id: true } });
        await tx.user.update({
          where: { id: existing.userId },
          data: { ...(cnpjOwner && cnpjOwner.id !== existing.userId ? {} : { cnpj }), name: legalName },
        });
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
      const user = await tx.user.findUnique({ where: { cnpj } });
      if (!user?.isActive || user.isPurged) throw new BadRequestException('Comerciante exige conta ativa previamente cadastrada');
      return tx.integrationMerchant.create({
        data: { cnpj, externalMerchantId, integrationKey, legalName, userId: user.id },
        select: { cnpj: true, externalMerchantId: true, id: true, integrationKey: true, legalName: true },
      });
    });
  }

  async merchant(integrationKey: string, externalMerchantId: string) {
    await resolveLegacyMerchantPlatform(this.prisma, integrationKey);
    const merchant = await this.prisma.integrationMerchant.findUnique({
      where: { integrationKey_externalMerchantId: { integrationKey, externalMerchantId } },
      include: { user: { include: { wallet: true } } },
    });
    if (!merchant?.user.wallet || !merchant.user.isActive || merchant.user.isPurged) throw new NotFoundException('Merchant não provisionado');
    return merchant;
  }

  quote(grossAmountCents: number, tag = 'GLOBAL') {
    if (!Number.isSafeInteger(grossAmountCents) || grossAmountCents <= 0) {
      throw new BadRequestException('Valor bruto inválido');
    }
    const feeCents = new Prisma.Decimal(getPlatformTaxaEffective(tag, 'TAXA_SAQUE_FIXA', 2)).plus(new Prisma.Decimal(grossAmountCents).div(100).mul(getPlatformTaxaEffective(tag, 'TAXA_SAQUE_PERCENT', 0))).mul(100).toDecimalPlaces(0).toNumber();
    const netAmountCents = grossAmountCents - feeCents;
    if (netAmountCents <= 0) throw new BadRequestException('Valor insuficiente para cobrir a taxa');
    return { feeCents, grossAmountCents, netAmountCents };
  }

  async summary(integrationKey: string, externalMerchantId: string) {
    const merchant = await this.merchant(integrationKey, externalMerchantId);
    const platform = await resolveLegacyMerchantPlatform(this.prisma, integrationKey);
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
        fixedCents: Math.round(getPlatformTaxaEffective(platform.tag, 'TAXA_SAQUE_FIXA', 2) * 100),
        percentBasisPoints: Math.round(getPlatformTaxaEffective(platform.tag, 'TAXA_SAQUE_PERCENT', 0) * 10_000),
      },
      processingCount: processing._count.id,
      processingGrossCents: Math.round(Number(processing._sum.grossAmount ?? 0) * 100),
    };
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
      if (!duplicate.grossAmount.equals(new Prisma.Decimal(input.grossAmountCents).div(100)) || duplicate.pixKey !== input.pixKey?.trim()) throw new ConflictException('Chave idempotente pertence a outro contrato');
      const bound = await resolveLegacyMerchantPlatform(this.prisma, integrationKey);
      if (![integrationKey, bound.tag.toLowerCase()].includes(duplicate.platform ?? '')) throw new ConflictException('Chave idempotente pertence a outra plataforma');
      return this.serializeWithdrawal(duplicate);
    }

    const platform = await resolveLegacyMerchantPlatform(this.prisma, integrationKey);
    const quote = this.quote(input.grossAmountCents, platform.tag);
    const pixKey = input.pixKey?.trim();
    if (!pixKey) throw new BadRequestException('Chave Pix obrigatória');
    const withdrawal = await new PlatformFinanceService(this.prisma).createWithdrawal({
      userId: merchant.userId, platform: platform.tag.toLowerCase(),
      amount: new Prisma.Decimal(quote.netAmountCents).div(100), fee: new Prisma.Decimal(quote.feeCents).div(100),
      grossAmount: new Prisma.Decimal(quote.grossAmountCents).div(100), pixKey, integrationRequestId: input.requestId,
      reserveWallet: true, singlePending: true, acquirer: platform.acquirer,
      context: { id: platform.id, tag: platform.tag, ownerUserId: platform.ownerUserId, acquirer: platform.acquirer },
      merchantId: merchant.id, merchantNamespace: integrationKey,
    });
    return this.serializeWithdrawal(withdrawal);
  }

  async listWithdrawals(integrationKey: string, externalMerchantId: string, page = 1, pageSize = 10) {
    const merchant = await this.merchant(integrationKey, externalMerchantId);
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const platform = await resolveLegacyMerchantPlatform(this.prisma, integrationKey);
    const where = { userId: merchant.userId, platform: { in: [integrationKey, platform.tag.toLowerCase()] } };
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
    const platform = await resolveLegacyMerchantPlatform(this.prisma, integrationKey);
    const item = await this.prisma.withdrawRequest.findFirst({ where: { id: withdrawalId, userId: merchant.userId, platform: { in: [integrationKey, platform.tag.toLowerCase()] } } });
    if (!item) throw new NotFoundException('Saque não encontrado');
    return this.serializeWithdrawal(item);
  }

  async reconcilePayments(integrationKey: string, externalMerchantId: string, paymentIds: string[], dryRun: boolean) {
    const merchant = await this.merchant(integrationKey, externalMerchantId);
    const platform = await resolveLegacyMerchantPlatform(this.prisma, integrationKey);
    let skipped = 0;
    const conflicts: string[] = [];
    for (const paymentId of [...new Set(paymentIds)].slice(0, 500)) {
      const transaction = await this.prisma.transaction.findFirst({ where: { acquirer: platform.acquirer,
        OR: [{ domPaymentId: paymentId }, { externalPaymentId: paymentId }] } });
      if (!transaction || !hasPlatformMarker(transaction.description, platform.tag) || transaction.userId !== merchant.userId) {
        conflicts.push(paymentId); continue;
      }
      skipped++;
    }
    // Reconciliation never transfers historical ownership or moves pooled wallet money.
    return { attributed: 0, conflicts, creditedCents: 0, dryRun, skipped };
  }

  async enqueueCurrentStatuses(): Promise<void> {
    const merchants = await this.prisma.integrationMerchant.findMany({ select: { id: true, userId: true, integrationKey: true } });
    for (const merchant of merchants) {
      let platform: Awaited<ReturnType<typeof resolveLegacyMerchantPlatform>>;
      try { platform = await resolveLegacyMerchantPlatform(this.prisma, merchant.integrationKey); } catch { continue; }
      const withdrawals = await this.prisma.withdrawRequest.findMany({
        where: { userId: merchant.userId, platform: { in: [merchant.integrationKey, platform.tag.toLowerCase()] } },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      for (const withdrawal of withdrawals) {
        await this.prisma.integrationWebhookDelivery.upsert({
          where: { withdrawalId_status: { status: withdrawal.status, withdrawalId: withdrawal.id } },
          create: merchantWithdrawalDelivery(merchant.id, withdrawal),
          update: {},
        });
      }
    }
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
