import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { CreatePaymentLinkUseCase } from '../../application/use-cases/payment-link/create-payment-link.use-case';
import { PaymentGatewayResolver } from '../../infrastructure/http/payment-gateway.resolver';
import { Acquirer } from '../../core/services/acquirer.enum';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { decryptPlatformSecret } from '../platform-integrations/platform-secrets';
import { PlatformContextService, type PlatformContext } from './platform-context.service';
import { unsupportedCapability } from './platform-adapters';
import { PlatformSubscriptionCapabilitiesService } from './platform-subscription-capabilities.service';

@Injectable()
export class PlatformBetaiService {
  constructor(private readonly prisma: PrismaService, private readonly contexts: PlatformContextService,
    private readonly modules: ModuleRef, private readonly subscriptions: PlatformSubscriptionCapabilitiesService,
    private readonly gateways: PaymentGatewayResolver) {}

  private async current(context?: PlatformContext) {
    if (context && context.tag !== 'BETAI') unsupportedCapability('billing');
    const current = await this.contexts.resolve('BETAI');
    if (context && (context.tag !== current.tag || context.id !== current.id || context.ownerUserId !== current.ownerUserId)) throw new BadRequestException('Contexto da plataforma mudou');
    return current;
  }

  async createBill(context: PlatformContext | undefined, body: { amountCents: number; title?: string; dueDate?: string; email?: string }) {
    const current = await this.current(context);
    if (current.acquirer !== 'DOM') unsupportedCapability('billing.create.FRENDZ');
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) throw new BadRequestException('amountCents inválido');
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (dueDate && Number.isNaN(dueDate.getTime())) throw new BadRequestException('dueDate inválido');
    const base = body.title?.trim() || 'Mensalidade Betai';
    const title = body.email ? `${base} — ${body.email}` : base;
    const link = await this.modules.get(CreatePaymentLinkUseCase, { strict: false }).execute({ userId: current.ownerUserId, allowLocalCheckout: true, dto: {
      titulo: title, descricao: title, valor: new Prisma.Decimal(body.amountCents).div(100).toNumber(),
      parcelasMax: 12, aceitaCartao: true, aceitaPix: true, plataformas: [current.tag],
    } });
    // Billing record references the same shared checkout; it does not credit a wallet.
    await this.prisma.cobranca.create({ data: { userId: current.ownerUserId, createdByUserId: current.ownerUserId,
      amount: new Prisma.Decimal(body.amountCents).div(100), description: title, mode: 'PAYABLE', status: 'PENDING', paymentRef: link.data.id,
      ...(dueDate ? { dueDate } : {}),
    } });
    return { linkCode: link.data.id, checkoutUrl: `${process.env.SIMPAY_CHECKOUT_URL}/?simLinkCode=${link.data.id}` };
  }

  async createPlan(body: { valor: number; label?: string }) {
    const current = await this.current();
    const amountCents = this.legacyCents(body.valor);
    const amount = amountCents / 100;
    const result = await this.subscriptions.createPlan(current, { amountCents, frequency: 'MENSAL', name: body.label?.trim() || `Mensalidade BetAi — ${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` });
    return { code: result.code, checkoutUrl: `${process.env.SIMPAY_CHECKOUT_URL}/?subscriptionLinkCode=${result.code}` };
  }

  legacyCents(value: number) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new BadRequestException('Valor inválido');
    const cents = new Prisma.Decimal(value).mul(100).toDecimalPlaces(0).toNumber();
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new BadRequestException('Valor inválido');
    return cents;
  }

  async cancelPlan(context: PlatformContext | undefined, code: string) {
    const current = await this.current(context);
    if (!code?.trim()) throw new BadRequestException('code obrigatório');
    if (current.acquirer !== 'DOM') unsupportedCapability('subscriptions.cancel.FRENDZ');
    const link = await this.prisma.subscriptionLink.findFirst({ where: { code, userId: current.ownerUserId,
      OR: [{ platformTag: current.tag }, { plataformas: { has: current.tag } }] }, select: { id: true } });
    if (!link) return { encontrada: false, canceladas: 0 };
    const config = await this.prisma.platformIntegration.findUnique({ where: { platformId_key: { platformId: current.id, key: 'DOM_TOKEN' } } });
    if (!config?.encryptedValue) unsupportedCapability('subscriptions.cancel.configuration');
    const token = decryptPlatformSecret(config.encryptedValue);
    const orders = await this.prisma.subscriptionLinkOrder.findMany({ where: { subscriptionLinkId: link.id, domSubscriptionId: { not: null } }, select: { domSubscriptionId: true } });
    await this.prisma.subscriptionLink.update({ where: { id: link.id }, data: { isActive: false } });
    let canceladas = 0;
    for (const order of orders) {
      if (!order.domSubscriptionId) continue;
      try { await this.gateways.byAcquirer(Acquirer.DOM).cancelSubscription(token, order.domSubscriptionId); canceladas++; }
      catch { /* Legacy response reports successful cancellations, allowing explicit retry. */ }
    }
    return { encontrada: true, canceladas };
  }

  async status(context: PlatformContext | undefined, code: string) {
    const current = await this.current(context);
    const link = await this.prisma.paymentLink.findFirst({ where: { id: code, userId: current.ownerUserId, plataformas: { has: current.tag } }, select: { id: true } });
    if (link) {
      const tx = await this.prisma.transaction.findFirst({ where: { paymentLinkId: link.id, status: 'COMPLETED' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } });
      if (tx) return { pago: true, pagoEm: tx.updatedAt };
    }
    try {
      const status = await this.subscriptions.paymentStatus(current, code);
      return { pago: status.paid, pagoEm: status.paidAt };
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      return { pago: false, pagoEm: null };
    }
  }
}
