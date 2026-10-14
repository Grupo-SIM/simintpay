import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PaymentGatewayResolver } from '../../../infrastructure/http/payment-gateway.resolver';
import { Acquirer } from '../../../core/services/acquirer.enum';
import { decryptPlatformSecret } from '../../platform-integrations/platform-secrets';
import { CreatePlatformPaymentDto } from './platform-payment.dto';
import { resolvePaymentAdapter } from './platform-payment.adapter';

export type PaymentPlatformContext = { id: string; tag: string; ownerUserId: string; acquirer: 'DOM' | 'FRENDZ' };

@Injectable()
export class PlatformPaymentsService {
  constructor(private readonly prisma: PrismaService, private readonly gateways: PaymentGatewayResolver) {}

  async create(context: PaymentPlatformContext, input: CreatePlatformPaymentDto) {
    return this.execute(context, input);
  }

  async createForMerchant(context: PaymentPlatformContext, externalMerchantId: string, input: CreatePlatformPaymentDto) {
    const integrationKey = `platform:${context.id}`;
    const merchant = await this.prisma.integrationMerchant.findUnique({
      where: { integrationKey_externalMerchantId: { integrationKey, externalMerchantId } }, include: { user: true },
    });
    if (!merchant || !merchant.user.isActive || merchant.user.isPurged) throw new NotFoundException('Merchant não provisionado ou inativo');
    return this.execute(context, input, merchant);
  }

  private async execute(context: PaymentPlatformContext, input: CreatePlatformPaymentDto, merchant?: { id: string; userId: string }) {
    // Re-resolve owner and activation immediately before financial writes.
    const platform = await this.prisma.platform.findUnique({ where: { id: context.id }, include: { owner: true, integrations: true } });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    if (!platform.isActive || !platform.owner.isActive || platform.owner.isPurged || platform.ownerUserId !== context.ownerUserId) throw new ForbiddenException('Contexto da plataforma mudou');
    if (input.paymentMethod !== 'PIX') throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'payments.' + input.paymentMethod });
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || !input.idempotencyKey || !input.customer) throw new UnprocessableEntityException({ code: 'INVALID_PAYMENT_CONTRACT' });
    const integration = platform.integrations.find(row => row.key === (platform.acquirer === 'DOM' ? 'DOM_TOKEN' : 'FRENDZ_TOKEN'));
    if (!integration?.encryptedValue) throw new UnprocessableEntityException({ code: 'PLATFORM_CONFIGURATION_MISSING', key: platform.acquirer === 'DOM' ? 'DOM_TOKEN' : 'FRENDZ_TOKEN' });
    const token = decryptPlatformSecret(integration.encryptedValue);
    const adapter = resolvePaymentAdapter(platform.tag);
    const financialUserId = merchant?.userId ?? platform.ownerUserId;
    const id = createHash('sha256').update(`${platform.id}\0${merchant?.id ?? ''}\0${input.idempotencyKey}`).digest('hex');
    const marker = `[TENANT:${platform.tag}]`;
    const description = `${adapter.description(input.description)} ${marker}`;
    const amount = new Prisma.Decimal(input.amountCents).div(100);
    const existing = await this.prisma.transaction.findUnique({ where: { id } });
    if (existing) {
      if (existing.userId !== financialUserId || !existing.amount.equals(amount) || existing.description !== description || existing.customerEmail !== input.customer.email || existing.customerDocument !== input.customer.document || existing.customerName !== input.customer.name || existing.customerPhone !== (input.customer.phone ?? '') || existing.paymentMethod !== 'PIX') throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      if (!existing.externalPaymentId) throw new ConflictException({ code: 'PAYMENT_PROCESSING', transactionId: id });
      return this.result(existing);
    }
    if (!await this.prisma.wallet.findUnique({ where: { userId: financialUserId } })) throw new UnprocessableEntityException({ code: 'WALLET_MISSING' });
    const overrides = await this.prisma.platformTaxaOverride.findMany({ where: { tag: { in: ['GLOBAL', platform.tag, platform.tag.replaceAll('-', '_')] } } });
    const rates: Record<string, number> = {};
    for (const row of overrides.filter(row => row.tag === 'GLOBAL')) rates[row.key] = row.value;
    for (const row of overrides.filter(row => row.tag !== 'GLOBAL')) rates[row.key] = row.value;
    try {
      await this.prisma.transaction.create({ data: {
        id, userId: financialUserId, amount, ...adapter.fees(amount, rates),
        status: 'DRAFT', paymentMethod: 'PIX', acquirer: platform.acquirer,
        description, customerName: input.customer.name, customerEmail: input.customer.email,
        customerDocument: input.customer.document, customerPhone: input.customer.phone ?? '', installments: 1,
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException({ code: 'PAYMENT_PROCESSING', transactionId: id });
      throw error;
    }
    // Frendz's current transport expects cents; DOM's expects reais.
    const payment = await this.gateways.byAcquirer(platform.acquirer as Acquirer).createPixCheckout(token, {
      codExternal: id, amount: platform.acquirer === 'FRENDZ' ? input.amountCents : amount.toNumber(),
      description: adapter.description(input.description), customerName: input.customer.name,
      customerEmail: input.customer.email, customerDocument: input.customer.document,
      customerPhone: input.customer.phone ?? '', documentType: input.customer.documentType,
    });
    const stored = await this.prisma.transaction.update({ where: { id }, data: {
      status: 'PENDING', externalPaymentId: payment.id,
      ...(platform.acquirer === 'DOM' ? { domPaymentId: payment.id } : {}),
      pixQrCode: payment.qrCode, pixContent: payment.pixContent,
      pixExpire: payment.pixExpire ? new Date(payment.pixExpire) : null,
    } });
    return this.result(stored);
  }

  private result(transaction: { id: string; externalPaymentId: string | null; status: string; amount: Prisma.Decimal; pixContent: string | null; pixQrCode: string | null; pixExpire: Date | null }) {
    return { transactionId: transaction.id, paymentId: transaction.externalPaymentId, status: transaction.status,
      amountCents: transaction.amount.mul(100).toNumber(), pixContent: transaction.pixContent,
      qrCode: transaction.pixQrCode, pixExpire: transaction.pixExpire };
  }
}
