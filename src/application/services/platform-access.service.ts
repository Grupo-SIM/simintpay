import { getPlatformIntegrationValue } from '../../modules/platform-integrations/platform-integrations.store';
import { getRegisteredPlatform, getPlatformOwnerId } from '../../modules/module.registry';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Centraliza a janela de acesso das plataformas SaaS por assinatura
 * (CONTROLE-MOTORISTA / CONTROLE-PATRIMONIAL): credita dias conforme a frequência,
 * resolve a URL de renovação e liga/desliga o login do usuário no backend do SaaS.
 *
 * Usado pelo fluxo PIX (process-dom-webhook), cartão (subscription-webhook) e pelo
 * cron de expiração (ExpirationReminderCron).
 */
@Injectable()
export class PlatformAccessService {
  private readonly logger = new Logger(PlatformAccessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Dias de acesso por ciclo conforme a frequência do plano/link. */
  daysForFrequency(freq?: string | null): number {
    switch (String(freq ?? '').toUpperCase()) {
      case 'ANUAL':
      case 'YEAR':
        return 365;
      case 'SEMESTRAL':
      case 'SEMESTER':
        return 180;
      case 'TRIMESTRAL':
      case 'QUARTER':
        return 90;
      case 'SEMANAL':
      case 'WEEKLY':
      case 'WEEK':
        return 7;
      default:
        return 30; // MONTHLY / MENSAL
    }
  }

  /** Rótulo amigável da plataforma para emails. */
  platformLabel(platformTag: string): string {
    return getRegisteredPlatform(platformTag)?.name ?? platformTag;
  }

  /** URL base cadastrada na integração da plataforma. */
  getSaasBaseUrl(platformTag: string): string | null {
    return getPlatformIntegrationValue(platformTag, 'BACKEND_URL')?.replace(/\/+$/, '') ?? null;
  }

  /**
   * Credita/estende a janela de acesso (PlatformSubscriberAccess) em `planDays`.
   * Considera 3 cenários: ativo com dias restantes (estende), pausado com dias
   * congelados (devolve + soma) e expirado (recomeça de agora). Idempotência fica
   * por conta do dedup de transação nos webhooks. Tolerante a erro.
   */
  async creditAccess(input: {
    platformTag: string;
    email: string;
    name?: string | null;
    cpf?: string | null;
    phone?: string | null;
    paymentMethod: 'PIX' | 'CREDIT_CARD';
    planDays: number;
    transactionId?: string | null;
  }): Promise<void> {
    const email = (input.email ?? '').toLowerCase().trim();
    if (!email) return;
    const platformTag = input.platformTag.toUpperCase();
    if (!getPlatformOwnerId(platformTag)) return;
    const days = input.planDays > 0 ? input.planDays : 30;
    const now = new Date();

    try {
      const current = await (this.prisma as any).platformSubscriberAccess.findUnique({
        where: { platformTag_customerEmail: { platformTag, customerEmail: email } },
      });

      if (current) {
        let base: Date;
        if (current.isActive && current.expiresAt > now) base = current.expiresAt;
        else if (!current.isActive && current.frozenDays > 0) base = new Date(now.getTime() + current.frozenDays * DAY_MS);
        else base = now;
        const newExpiry = new Date(base.getTime() + days * DAY_MS);
        await (this.prisma as any).platformSubscriberAccess.update({
          where: { platformTag_customerEmail: { platformTag, customerEmail: email } },
          data: {
            isActive: true,
            expiresAt: newExpiry,
            frozenDays: 0,
            totalDaysCredited: current.totalDaysCredited + days,
            lastTransactionId: input.transactionId ?? current.lastTransactionId,
            lastPaymentMethod: input.paymentMethod,
            customerName: input.name ?? current.customerName,
            customerCpf: input.cpf ?? current.customerCpf,
            customerPhone: input.phone ?? current.customerPhone,
          },
        });
      } else {
        const newExpiry = new Date(now.getTime() + days * DAY_MS);
        await (this.prisma as any).platformSubscriberAccess.create({
          data: {
            platformTag,
            customerEmail: email,
            customerName: input.name ?? null,
            customerCpf: input.cpf ?? null,
            customerPhone: input.phone ?? null,
            isActive: true,
            expiresAt: newExpiry,
            frozenDays: 0,
            totalDaysCredited: days,
            lastTransactionId: input.transactionId ?? null,
            lastPaymentMethod: input.paymentMethod,
          },
        });
      }
      this.logger.log(`[PlatformAccess][${platformTag}] acesso creditado email=${email} +${days}d (${input.paymentMethod})`);
    } catch (e: any) {
      this.logger.error(`[PlatformAccess][${platformTag}] creditAccess falhou email=${email}: ${e?.message}`);
    }
  }

  /** Liga/desliga o login do usuário no backend do SaaS (bloqueio/desbloqueio). */
  async setSaasUserActive(platformTag: string, email: string, isActive: boolean): Promise<void> {
    const baseUrl = this.getSaasBaseUrl(platformTag);
    const token = getPlatformIntegrationValue(platformTag, 'INTERNAL_TOKEN');
    if (!baseUrl || !token) {
      this.logger.warn(`[PlatformAccess][${platformTag}] URL/token não configurado — toggle ignorado`);
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/internal/users/toggle-by-email`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: JSON.stringify({ email, isActive }),
      });
      this.logger.log(`[PlatformAccess][${platformTag}] toggle-by-email isActive=${isActive} email=${email} HTTP ${res.status}`);
    } catch (err: unknown) {
      this.logger.warn(`[PlatformAccess][${platformTag}] toggle falhou email=${email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** URL de renovação (checkout do subscription link) do cliente naquela plataforma. */
  async resolveRenewUrl(platformTag: string, email: string): Promise<string | undefined> {
    const tag = platformTag.toUpperCase();
    const order = await (this.prisma as any).subscriptionLinkOrder.findFirst({
      where: {
        customerEmail: email,
        subscriptionLink: {
          OR: [{ platformTag: tag }, { plataformas: { has: tag } }],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { subscriptionLink: { select: { code: true } } },
    });
    const code = order?.subscriptionLink?.code;
    return code ? `${process.env.SIMPAY_CHECKOUT_URL}/?subscriptionLinkCode=${code}` : undefined;
  }
}
