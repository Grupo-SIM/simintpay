import { quoteDeliveryCharge } from '../../integrations/delivery-payment-allocation';
import { deliveryProfile } from '../../platform-core/delivery-profile';
import type { PlatformContext } from '../../platform-core/platform-context.service';
import { loadFinancialPolicy } from '../../financial-policy/financial-policy.service';
import { quoteFinancialCharge } from '../../financial-policy/financial-charge';
import { platformMerchant } from '../../platform-core/platform-merchant-lookup';
import { PlatformPaymentLookup } from './platform-payment-lookup';
import { PlatformPaymentExecution } from './platform-payment-execution';
import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PaymentGatewayResolver } from '../../../infrastructure/http/payment-gateway.resolver';
import { Acquirer } from '../../../core/services/acquirer.enum';
import { decryptPlatformSecret } from '../../platform-integrations/platform-secrets';
import { CreatePlatformPaymentDto } from './platform-payment.dto';
import { resolvePaymentAdapter } from './platform-payment.adapter';
import { resolveCardAcquirer } from './platform-card-acquirer.adapter';

export type PaymentPlatformContext = { id: string; tag: string; ownerUserId: string; acquirer: 'DOM' | 'FRENDZ'; delivery?: PlatformContext['delivery'] };

@Injectable()
export class PlatformPaymentsService {
  constructor(private readonly prisma: PrismaService, private readonly gateways: PaymentGatewayResolver) {}

  async read(context: PaymentPlatformContext, reference: string) {
    const payment = await new PlatformPaymentLookup(this.prisma).find(context, reference);
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    return this.result(payment);
  }

  async create(context: PaymentPlatformContext, input: CreatePlatformPaymentDto) {
    return this.execute(context, input);
  }

  async createForMerchant(context: PaymentPlatformContext, externalMerchantId: string, input: CreatePlatformPaymentDto) {
    const merchant = await platformMerchant(this.prisma, context, externalMerchantId);
    return this.execute(context, input, merchant);
  }

  async readByKey(context: PaymentPlatformContext, externalMerchantId: string, key: string) {
    const merchant = await platformMerchant(this.prisma, context, externalMerchantId);
    const id = createHash('sha256').update(`${context.id}\0${merchant.id}\0${key}`).digest('hex');
    return this.read(context, id);
  }

  private async execute(context: PaymentPlatformContext, input: CreatePlatformPaymentDto, merchant?: { id: string; userId: string }) {
    // Re-resolve owner and activation immediately before financial writes.
    const platform = await this.prisma.platform.findUnique({ where: { id: context.id }, include: { owner: true, integrations: true } });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    if (!platform.isActive || !platform.owner.isActive || platform.owner.isPurged || platform.ownerUserId !== context.ownerUserId) throw new ForbiddenException('Contexto da plataforma mudou');
    if (!['PIX', 'CREDIT_CARD'].includes(input.paymentMethod)) throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'payments.' + input.paymentMethod });
    if (input.linkId) {
      const link = await this.prisma.paymentLink.findFirst({ where: { id: input.linkId, userId: platform.ownerUserId, plataformas: { has: platform.tag }, isActive: true } });
      if (!link || !link.amount.mul(100).equals(input.amountCents)) throw new UnprocessableEntityException({ code: 'INVALID_LINK_PAYMENT' });
    }
    const cardAcquirer = input.paymentMethod === 'CREDIT_CARD' ? resolveCardAcquirer(platform.acquirer) : undefined;
    if (cardAcquirer && (!input.card || !input.card.token || !input.card.holderName || !/^\d{6,8}$/.test(input.card.bin) || !input.card.brand || !Number.isInteger(input.card.installments) || input.card.installments < 1 || input.card.installments > 12)) throw new UnprocessableEntityException({ code: 'INVALID_PAYMENT_CONTRACT' });
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 999999999999 || !input.idempotencyKey || input.idempotencyKey.length > 128 || !input.customer) throw new UnprocessableEntityException({ code: 'INVALID_PAYMENT_CONTRACT' });
    if (input.allocation && (!context.delivery?.allocate || !merchant || context.delivery.merchantId !== merchant.id)) throw new ForbiddenException('Divisão financeira não autorizada');
    if (context.delivery && !input.allocation) throw new UnprocessableEntityException({ code: 'DELIVERY_ALLOCATION_REQUIRED' });
    const acquiring = context.delivery ? await deliveryProfile(this.prisma, context) : null;
    const integration = platform.integrations.find(row => row.key === (platform.acquirer === 'DOM' ? 'DOM_TOKEN' : 'FRENDZ_TOKEN'));
    if (!acquiring && !integration?.encryptedValue) throw new UnprocessableEntityException({ code: 'PLATFORM_CONFIGURATION_MISSING', key: platform.acquirer === 'DOM' ? 'DOM_TOKEN' : 'FRENDZ_TOKEN' });
    const token = acquiring?.token ?? decryptPlatformSecret(integration!.encryptedValue!);
    const adapter = resolvePaymentAdapter(platform.tag);
    const financialUserId = merchant?.userId ?? platform.ownerUserId;
    const id = createHash('sha256').update(`${platform.id}\0${merchant?.id ?? ''}\0${input.idempotencyKey}`).digest('hex');
    const marker = `[TENANT:${platform.tag}]`;
    // Persist only a digest of card contract; never persist reusable tokens.
    const cardDigest = cardAcquirer ? ` [REQUEST:${createHash('sha256').update(JSON.stringify([input.card!.token, input.card!.holderName, input.card!.bin, input.card!.brand, input.card!.installments])).digest('hex')}]` : '';
    const description = `${adapter.description(input.description)} ${marker}${cardDigest}`;
    const amount = new Prisma.Decimal(input.amountCents).div(100);
    const existing = await this.prisma.transaction.findUnique({ where: { id } });
    if (existing) {
      if (existing.userId !== financialUserId || (existing.paymentLinkId ?? undefined) !== input.linkId || !(existing.financialSnapshot ? new Prisma.Decimal(((existing.financialSnapshot as { originalCents?: number; totalAmountCents?: number }).originalCents ?? (existing.financialSnapshot as { totalAmountCents: number }).totalAmountCents)).div(100).equals(amount) : existing.amount.equals(amount)) || existing.description !== description || existing.customerEmail !== input.customer.email || existing.customerDocument !== input.customer.document || existing.customerName !== input.customer.name || existing.customerPhone !== (input.customer.phone ?? '') || existing.paymentMethod !== input.paymentMethod) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      if (!existing.externalPaymentId) throw new ConflictException({ code: 'PAYMENT_PROCESSING', transactionId: id });
      if (input.allocation && JSON.stringify([input.allocation.merchantAmountCents, input.allocation.platformFeeCents]) !== JSON.stringify([(existing.financialSnapshot as any)?.merchantAmountCents, (existing.financialSnapshot as any)?.platformFeeCents])) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      return this.result(existing);
    }
    await this.prisma.wallet.upsert({ where: { userId: financialUserId }, update: {}, create: { userId: financialUserId, balance: 0, lockedBalance: 0 } });
    const overrides = await this.prisma.platformTaxaOverride.findMany({ where: { tag: { in: ['GLOBAL', platform.tag, platform.tag.replaceAll('-', '_')] } } });
    const rates: Record<string, number> = {};
    for (const row of overrides.filter(row => row.tag === 'GLOBAL')) rates[row.key] = row.value;
    for (const row of overrides.filter(row => row.tag !== 'GLOBAL')) rates[row.key] = row.value;
    const financialQuote = input.allocation ? { ...quoteDeliveryCharge(amount.toNumber(), input.allocation), platformProfit: input.allocation.platformFeeCents / 100 } : quoteFinancialCharge({ policy: await loadFinancialPolicy(this.prisma, platform.tag), acquirer: platform.acquirer, tag: platform.tag }, amount.toNumber(), input.paymentMethod as 'PIX' | 'CREDIT_CARD', cardAcquirer ? input.card!.installments : 1);
    const chargeAmount = new Prisma.Decimal(financialQuote?.totalAmount ?? amount);
    const chargeCents = chargeAmount.mul(100).toNumber();
    const financialFields = financialQuote ? {
      amount: chargeAmount, netAmount: new Prisma.Decimal(financialQuote.netAmount), totalFee: new Prisma.Decimal(financialQuote.totalFeeAmount),
      domFee: new Prisma.Decimal(financialQuote.domFeeAmount), platformFee: new Prisma.Decimal(financialQuote.platformProfit),
      financialSnapshot: financialQuote.financialSnapshot, settlementBasis: 'FINAL_NET' as const,
    } : adapter.fees(amount, rates, cardAcquirer ? input.card!.installments : undefined);
    try {
      await new PlatformPaymentExecution(this.prisma).reserve({
        id, userId: financialUserId, tracking: { ...(context.delivery ? { delivery: { credentialId: context.delivery.credentialId, externalCompanyId: context.delivery.externalCompanyId, idempotencyKey: input.idempotencyKey } } : {}), reportAttribution: { platformId: platform.id, ownerUserId: platform.ownerUserId, beneficiaryUserId: financialUserId } }, amount, ...(input.linkId ? { paymentLinkId: input.linkId } : {}), ...financialFields,
        status: 'DRAFT', paymentMethod: input.paymentMethod, acquirer: platform.acquirer,
        description, customerName: input.customer.name, customerEmail: input.customer.email,
        customerDocument: input.customer.document, customerPhone: input.customer.phone ?? '', installments: cardAcquirer ? input.card!.installments : 1,
        ...(cardAcquirer ? { cardBin: input.card!.bin, cardBrand: input.card!.brand } : {}),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException({ code: 'PAYMENT_PROCESSING', transactionId: id });
      throw error;
    }
    // Frendz's current transport expects cents; DOM's expects reais.
    const { transaction: stored } = await new PlatformPaymentExecution(this.prisma).charge({
      transactionId: id,
      charge: async () => cardAcquirer ? cardAcquirer.charge(token, { id, amountCents: chargeCents, description: `${adapter.description(input.description)} ${marker}`, customer: input.customer, card: input.card! }) : this.gateways.byAcquirer(platform.acquirer as Acquirer).createPixCheckout(token, {
        codExternal: id, amount: platform.acquirer === 'FRENDZ' ? chargeCents : chargeAmount.toNumber(),
        description: `${adapter.description(input.description)} ${marker}`, customerName: input.customer.name,
        customerEmail: input.customer.email, customerDocument: input.customer.document,
        customerPhone: input.customer.phone ?? '', documentType: input.customer.documentType,
      }),
      rejection: payment => !!cardAcquirer && ['not_authorized', 'error', 'failed', 'refused', 'canceled', 'expired'].includes(payment.status),
      references: payment => ({ externalPaymentId: payment.id,
        ...(platform.acquirer === 'DOM' ? { domPaymentId: payment.id } : {}),
        pixQrCode: payment.qrCode, pixContent: payment.pixContent,
        pixExpire: payment.pixExpire ? new Date(payment.pixExpire) : null,
      }),
    });
    return this.result(stored);
  }

  private result(transaction: { id: string; externalPaymentId: string | null; status: string; amount: Prisma.Decimal; netAmount?: Prisma.Decimal | null; pixContent: string | null; pixQrCode: string | null; pixExpire: Date | null }) {
    return { transactionId: transaction.id, paymentId: transaction.externalPaymentId, status: transaction.status,
      amountCents: transaction.amount.mul(100).toNumber(), netAmountCents: transaction.netAmount?.mul(100).toNumber() ?? null, pixContent: transaction.pixContent,
      qrCode: transaction.pixQrCode, pixExpire: transaction.pixExpire };
  }
}
