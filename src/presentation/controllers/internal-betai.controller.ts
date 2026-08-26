import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY } from '../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { Inject } from '@nestjs/common';
import { CreateSubscriptionLinkUseCase } from '../../application/use-cases/subscription-link/create-subscription-link.use-case';
import type { CreateSubscriptionLinkDto } from '../../application/dtos/subscription-link/create-subscription-link.dto';

/**
 * Serviço de cobrança para o Betai (mensalidade por faixa via link mensal).
 * O Betai é o dono do estado (vencimento/pago); aqui só geramos o link de pagamento
 * (SIMINTPAY, dono = master) + uma Cobranca PAYABLE (para aparecer no admin-card-machine)
 * e devolvemos o status de pagamento quando perguntado.
 */
@Controller('internal/betai')
export class InternalBetaiController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly createSubscriptionLink: CreateSubscriptionLinkUseCase,
  ) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  private async resolveMasterId(): Promise<string | null> {
    const emails = (process.env.MASTER_ADMIN_EMAILS || 'adminljl@simpay.com.br')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const u = await this.prisma.user.findFirst({
      where: { email: { in: emails } },
      select: { id: true },
    });
    return u?.id ?? null;
  }

  @Post('cobranca')
  @ApiOperation({ summary: 'Betai: cria um link de pagamento (mensalidade) + Cobranca PAYABLE' })
  async criarCobranca(
    @Body() body: { valor: number; titulo?: string; dueDate?: string; email?: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);

    const amount = Number(Number(body?.valor).toFixed(2));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Valor inválido');
    }
    const masterId = await this.resolveMasterId();
    if (!masterId) throw new BadRequestException('Conta master não encontrada');

    const dueDate = body?.dueDate ? new Date(body.dueDate) : null;
    const base = body?.titulo?.trim() || 'Mensalidade Betai';
    const titulo = body?.email ? `${base} — ${body.email}` : base;

    // Registra o link na DOM (cartão). Falha não bloqueia: o checkout PIX usa o link local.
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY || '';
    let domPaymentLinkId: string | null = null;
    if (domToken) {
      try {
        const created = await this.gateway.createPaymentLink(domToken, {
          title: titulo,
          description: titulo,
          amount,
          maxInstallments: 12,
          interestRateInstallment: 0,
          aceitaCartao: true,
          aceitaPix: true,
        });
        domPaymentLinkId = created?.id ?? null;
      } catch {
        // segue sem registro DOM
      }
    }

    // Link de pagamento: dono = MASTER (o valor cai pro master), plataforma SIMINTPAY.
    const link = await this.prisma.paymentLink.create({
      data: {
        userId: masterId,
        title: titulo,
        description: titulo,
        amount,
        maxInstallments: 12,
        plataformas: ['SIMINTPAY'],
        domPaymentLinkId,
      },
      select: { id: true },
    });

    // Cobranca PAYABLE → aparece no admin-card-machine (vencido/pago). userId = master
    // (FK); o investidor real fica no título/descrição.
    await this.prisma.cobranca.create({
      data: {
        userId: masterId,
        amount,
        description: titulo,
        mode: 'PAYABLE',
        status: 'PENDING',
        createdByUserId: masterId,
        ...(dueDate && !Number.isNaN(dueDate.getTime()) ? { dueDate } : {}),
        paymentRef: link.id,
      },
    });

    return {
      linkCode: link.id,
      checkoutUrl: `${process.env.SIMPAY_CHECKOUT_URL}/?simLinkCode=${link.id}`,
    };
  }

  @Post('plano')
  @ApiOperation({ summary: 'Betai: cria um plano de assinatura mensal (por faixa de valor)' })
  async criarPlano(
    @Body() body: { valor: number; label?: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const amount = Number(Number(body?.valor).toFixed(2));
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    const masterId = await this.resolveMasterId();
    if (!masterId) throw new BadRequestException('Conta master não encontrada');

    const nome = body?.label?.trim()
      || `Mensalidade BetAi — ${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;

    const dto: CreateSubscriptionLinkDto = {
      nome,
      valor: amount,
      frequencia: 'MENSAL',
      isStandalone: true,
      paymentMethods: 'BOTH',
      plataformas: ['SIMINTPAY'],
    } as CreateSubscriptionLinkDto;

    const res = await this.createSubscriptionLink.execute({ userId: masterId, role: 'ADMIN', dto });
    const code = res?.data?.codigo;
    if (!code) throw new BadRequestException('Falha ao criar plano de assinatura');
    return {
      code,
      checkoutUrl: `${process.env.SIMPAY_CHECKOUT_URL}/?subscriptionLinkCode=${code}`,
    };
  }

  @Post('plano/cancelar')
  @ApiOperation({ summary: 'Betai: cancela um plano (desativa o link + cancela assinaturas de cartão ativas)' })
  async cancelarPlano(
    @Body() body: { code?: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const code = String(body?.code ?? '').trim();
    if (!code) throw new BadRequestException('code obrigatório');

    const link = await this.prisma.subscriptionLink.findUnique({ where: { code }, select: { id: true } });
    if (!link) return { encontrada: false, canceladas: 0 };

    await this.prisma.subscriptionLink.update({ where: { id: link.id }, data: { isActive: false } });

    const orders = await this.prisma.subscriptionLinkOrder.findMany({
      where: { subscriptionLinkId: link.id, domSubscriptionId: { not: null } },
      select: { domSubscriptionId: true },
    });
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY || '';
    let canceladas = 0;
    if (domToken) {
      for (const o of orders) {
        if (!o.domSubscriptionId) continue;
        try {
          await this.gateway.cancelSubscription(domToken, o.domSubscriptionId);
          canceladas += 1;
        } catch {
          // segue cancelando os demais
        }
      }
    }
    return { encontrada: true, canceladas };
  }

  @Get('cobranca/:code/status')
  @ApiOperation({ summary: 'Betai: status de pagamento de um link (mensalidade)' })
  async statusCobranca(
    @Param('code') code: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    // 1) Link de pagamento avulso (one-time): pago se houver transação COMPLETED.
    const tx = await this.prisma.transaction.findFirst({
      where: { paymentLinkId: code, status: 'COMPLETED' },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    if (tx) return { pago: true, pagoEm: tx.updatedAt };

    // 2) Link de assinatura (plano): pago/assinado se houver order paga ou ativa.
    const subLink = await this.prisma.subscriptionLink.findUnique({
      where: { code },
      select: { id: true },
    });
    if (subLink) {
      const order = await this.prisma.subscriptionLinkOrder.findFirst({
        where: { subscriptionLinkId: subLink.id, status: { in: ['paid', 'active'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (order) return { pago: true, pagoEm: order.createdAt };
    }

    return { pago: false, pagoEm: null };
  }
}
