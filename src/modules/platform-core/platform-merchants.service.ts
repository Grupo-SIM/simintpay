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
    const cnpj = String(body.cnpj ?? '').replace(/\D/g, '');
    const legalName = typeof body.legalName === 'string' ? body.legalName.trim() : '';
    if (cnpj.length !== 14 || !legalName || !externalMerchantId.trim()) throw new BadRequestException('CNPJ, razão social e referência obrigatórios');
    // Provisioning associates an existing active account. No inferred or technical users.
    const user = await this.prisma.user.findUnique({ where: { cnpj } });
    if (!user?.isActive || user.isPurged) throw new BadRequestException('Comerciante exige conta ativa previamente cadastrada');
    const integrationKey = this.namespace(context);
    try {
      return await this.prisma.integrationMerchant.upsert({ where: { integrationKey_externalMerchantId: { integrationKey, externalMerchantId } },
        create: { integrationKey, externalMerchantId, userId: user.id, cnpj, legalName }, update: { userId: user.id, cnpj, legalName },
        select: { id: true, externalMerchantId: true, cnpj: true, legalName: true } });
    } catch (error) { if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Comerciante já associado'); throw error; }
  }

  async resolve(context: PlatformContext, externalMerchantId: string) {
    const merchant = await this.prisma.integrationMerchant.findUnique({ where: { integrationKey_externalMerchantId: { integrationKey: this.namespace(context), externalMerchantId } }, include: { user: true } });
    if (!merchant?.user.isActive || merchant.user.isPurged) throw new NotFoundException('Comerciante não associado ou inativo');
    return merchant;
  }
  createPayment(context: PlatformContext, externalMerchantId: string, input: CreatePlatformPaymentDto) { return this.payments.createForMerchant(context, externalMerchantId, input); }
  async summary(context: PlatformContext, externalMerchantId: string) {
    const merchant = await this.resolve(context, externalMerchantId);
    return { ...await this.finance.summary({ ...context, ownerUserId: merchant.userId }), walletScope: 'merchant-user' };
  }
  async payment(context: PlatformContext, externalMerchantId: string, paymentId: string) {
    const merchant = await this.resolve(context, externalMerchantId);
    const payment = await this.prisma.transaction.findFirst({ where: { userId: merchant.userId, acquirer: context.acquirer, description: { contains: `[TENANT:${context.tag}]` }, OR: [{ id: paymentId }, { externalPaymentId: paymentId }] } });
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    return { transactionId: payment.id, paymentId: payment.externalPaymentId, status: payment.status, amountCents: this.finance.cents(payment.amount) };
  }
  async withdrawals(context: PlatformContext, externalMerchantId: string) { const merchant = await this.resolve(context, externalMerchantId); return this.finance.withdrawals({ ...context, ownerUserId: merchant.userId }); }
  async withdraw(context: PlatformContext, externalMerchantId: string, body: { amountCents: number; pixKey: string; idempotencyKey: string }) {
    const merchant = await this.resolve(context, externalMerchantId);
    return this.finance.requestWithdrawal(context, body, merchant);
  }
}
