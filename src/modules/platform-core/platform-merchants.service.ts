import { PlatformMerchantProvisioning } from './platform-merchant-provisioning';
import { Prisma } from '@prisma/client';
import { platformMerchant } from './platform-merchant-lookup';
import { PlatformPaymentLookup } from '../unified-platform/payments/platform-payment-lookup';
import { IntegrationFinanceService } from '../integrations/integration-finance.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PlatformPaymentsService } from '../unified-platform/payments/platform-payments.service';
import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { CreatePlatformPaymentDto } from '../unified-platform/payments/platform-payment.dto';
import type { PlatformContext } from './platform-context.service';

@Injectable()
export class PlatformMerchantsService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PlatformPaymentsService, private readonly finance: PlatformFinanceService) {}
  private namespace(context: PlatformContext) { return `platform:${context.id}`; }

  async provision(context: PlatformContext, externalMerchantId: string, body: { cnpj: string; legalName: string }) {
    const { integrationKey, ...result } = await new PlatformMerchantProvisioning(this.prisma).provision(this.namespace(context), externalMerchantId, body);
    return result;
  }

  async resolve(context: PlatformContext, externalMerchantId: string) {
    return platformMerchant(this.prisma, context, externalMerchantId);
  }

  createPayment(context: PlatformContext, externalMerchantId: string, input: CreatePlatformPaymentDto) { return this.payments.createForMerchant(context, externalMerchantId, input); }
  async summary(context: PlatformContext, externalMerchantId: string) {
    const merchant = await this.resolve(context, externalMerchantId);
    const { feePolicy, ...processing } = await new IntegrationFinanceService(this.prisma).summary(merchant.integrationKey, externalMerchantId, true);
    return { ...await this.finance.summary({ ...context, ownerUserId: merchant.userId }), ...processing, feePolicy: { fixedCents: feePolicy.fixedCents, rate: new Prisma.Decimal(feePolicy.percentBasisPoints).div(10000).toNumber() }, walletScope: 'merchant-user' };
  }
  async payment(context: PlatformContext, externalMerchantId: string, paymentId: string) {
    const merchant = await this.resolve(context, externalMerchantId);
    const payment = await new PlatformPaymentLookup(this.prisma).find(context, paymentId, merchant.userId);
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    return { transactionId: payment.id, paymentId: payment.externalPaymentId, status: payment.status, amountCents: this.finance.cents(payment.amount) };
  }
  async withdrawals(context: PlatformContext, externalMerchantId: string, page = 1, limit = 20) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Paginação inválida');
    const merchant = await this.resolve(context, externalMerchantId);
    const result = await new IntegrationFinanceService(this.prisma).listWithdrawals(merchant.integrationKey, externalMerchantId, page, limit);
    return { unit: 'cents', data: result.items.map(({ netAmountCents, ...row }) => ({ ...row, amountCents: netAmountCents })), meta: { page, limit, total: result.meta.totalItems, totalPages: result.meta.totalPages } };
  }
  async withdrawal(context: PlatformContext, externalMerchantId: string, withdrawalId: string) {
    const merchant = await this.resolve(context, externalMerchantId);
    const { netAmountCents, ...row } = await new IntegrationFinanceService(this.prisma).getWithdrawal(merchant.integrationKey, externalMerchantId, withdrawalId);
    return { unit: 'cents', ...row, amountCents: netAmountCents };
  }
  async quote(context: PlatformContext, externalMerchantId: string, amountCents: number) {
    await this.resolve(context, externalMerchantId);
    return new IntegrationFinanceService(this.prisma).quote(amountCents, context.tag);
  }
  async reconcile(context: PlatformContext, externalMerchantId: string, paymentIds: string[], dryRun: boolean) {
    if (!Array.isArray(paymentIds) || paymentIds.length > 500 || paymentIds.some(id => typeof id !== 'string' || !id.trim()) || typeof dryRun !== 'boolean') throw new BadRequestException('Contrato inválido');
    const merchant = await this.resolve(context, externalMerchantId);
    return new IntegrationFinanceService(this.prisma).reconcilePayments(merchant.integrationKey, externalMerchantId, paymentIds, dryRun);
  }
  async withdraw(context: PlatformContext, externalMerchantId: string, body: { amountCents: number; pixKey: string; idempotencyKey: string }) {
    const merchant = await this.resolve(context, externalMerchantId);
    return this.finance.requestWithdrawal(context, body, merchant);
  }
}
