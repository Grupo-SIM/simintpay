import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { PlatformSaasAccessService } from './platform-saas-access.service';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { CreateSubscriptionLinkUseCase } from '../../application/use-cases/subscription-link/create-subscription-link.use-case';
import { PlatformContextService, type PlatformContext } from './platform-context.service';
import { unsupportedCapability } from './platform-adapters';
import type { PlatformPlanImportDto, PlatformSubscriptionPlanDto } from './platform-subscription-capabilities.dto';

const subscriptionTags = new Set(['BETAI', 'PAGATG', 'CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL']);
const saasTags = new Set(['CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL']);

/** Authenticated corporate contracts; subscription creation remains in existing shared use case. */
@Injectable()
export class PlatformSubscriptionCapabilitiesService {
  constructor(private readonly prisma: PrismaService, private readonly contexts: PlatformContextService, private readonly modules: ModuleRef) {}

  private async current(context: PlatformContext, capability: string, tags = subscriptionTags) {
    const current = await this.contexts.resolve(context.tag);
    if (!tags.has(current.tag)) unsupportedCapability(capability);
    if (current.id !== context.id || current.tag !== context.tag || current.ownerUserId !== context.ownerUserId) throw new BadRequestException('Contexto da plataforma mudou');
    return current;
  }

  async createPlan(context: PlatformContext, body: PlatformSubscriptionPlanDto) {
    const current = await this.current(context, 'subscriptions.create');
    // Existing subscription use case supports DOM only; never fall back from Frendz.
    if (current.acquirer !== 'DOM') unsupportedCapability('subscriptions.create.FRENDZ');
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) throw new BadRequestException('amountCents inválido');
    const result = await this.modules.get(CreateSubscriptionLinkUseCase, { strict: false }).execute({
      userId: current.ownerUserId, role: 'USER', dto: {
        nome: body.name, descricao: body.description, valor: new Prisma.Decimal(body.amountCents).div(100).toNumber(),
        frequencia: body.frequency, isStandalone: true, paymentMethods: 'BOTH', platformTag: current.tag, plataformas: [current.tag],
      },
    });
    return { id: result.data.id, code: result.data.codigo, name: result.data.nome,
      amountCents: new Prisma.Decimal(result.data.valor).mul(100).toNumber(), frequency: body.frequency, isActive: result.data.ativo };
  }

  async importPlan(context: PlatformContext, body: PlatformPlanImportDto) {
    const current = await this.current(context, 'subscriptions.import', new Set(['PAGATG']));
    if (current.acquirer !== 'DOM') unsupportedCapability('subscriptions.import.FRENDZ');
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0 || !body.code?.trim() || !body.name?.trim()) throw new BadRequestException('Plano inválido');
    return this.modules.get(PlatformFinanceService, { strict: false }).mirrorPlan(current.tag, current.ownerUserId, body.code.trim(), {
      name: body.name.trim(), price: new Prisma.Decimal(body.amountCents).div(100), type: body.type,
      domPlanId: body.externalPlanId?.trim() || null, redirectUrl: body.redirectUrl, webhookUrl: body.webhookUrl,
      isActive: body.isActive ?? true, paymentMethods: body.paymentMethods ?? 'CREDIT_CARD',
    }, current);
  }

  async paymentStatus(context: PlatformContext, code: string) {
    const current = await this.current(context, 'subscriptions.status');
    const link = await this.prisma.subscriptionLink.findFirst({ where: { code, userId: current.ownerUserId,
      OR: [{ platformTag: current.tag }, { plataformas: { has: current.tag } }] }, select: { id: true } });
    if (!link) throw new NotFoundException('Assinatura não encontrada');
    const order = await this.prisma.subscriptionLinkOrder.findFirst({ where: { subscriptionLinkId: link.id, status: { in: ['paid', 'active'] } },
      orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    return { paid: !!order, paidAt: order?.createdAt ?? null };
  }

  async subscribers(context: PlatformContext, status: string, page: string, limit: string) {
    const current = await this.current(context, 'saas.subscribers', saasTags);
    return new PlatformSaasAccessService(this.prisma).list(current.tag, status, page, limit);
  }

  async toggleSubscriber(context: PlatformContext, subscriberId: string) {
    const current = await this.current(context, 'saas.toggle', saasTags);
    return new PlatformSaasAccessService(this.prisma).toggle(current.tag, subscriberId);
  }

  async access(context: PlatformContext, email: string) {
    const current = await this.current(context, 'saas.access', saasTags);
    if (!email?.trim() || !email.includes('@')) throw new BadRequestException('E-mail obrigatório');
    const access = await this.prisma.platformSubscriberAccess.findUnique({
      where: { platformTag_customerEmail: { platformTag: current.tag, customerEmail: email.toLowerCase().trim() } },
      select: { isActive: true, expiresAt: true, frozenDays: true, totalDaysCredited: true, lastPaymentMethod: true },
    });
    return { exists: !!access, access: access ?? null };
  }
}
