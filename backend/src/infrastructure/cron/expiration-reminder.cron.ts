import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PlatformAccessService } from '../../application/services/platform-access.service';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class ExpirationReminderCron {
  private readonly logger = new Logger(ExpirationReminderCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly platformAccess: PlatformAccessService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleCron() {
    this.logger.log('Iniciando cron de lembrete de expiração de planos...');

    await Promise.all([
      this.processPixPlans(),
      this.processCcSubscriptions(),
      this.processPlatformSubscriberAccess(),
    ]);

    this.logger.log('Cron de lembrete de expiração concluído.');
  }

  /**
   * Ciclo de vida das plataformas SaaS por assinatura (CONTROLE-MOTORISTA / CONTROLE-PATRIMONIAL):
   * - 3/2/1/0 dias antes do vencimento → email de aviso ("vai vencer").
   * - vencido há 1+ dia (1 dia de tolerância) → bloqueia o login no SaaS, marca o acesso
   *   inativo e envia o email de renovação ("expirou"). Como fica inativo, não reprocessa.
   * Pagar/renovar reativa automaticamente (creditAccess + provision isActive=true).
   */
  private async processPlatformSubscriberAccess() {
    const todayLocal = dayjs().tz('America/Sao_Paulo').startOf('day');

    const records = await this.prisma.platformSubscriberAccess.findMany({
      where: { isActive: true },
    });

    for (const rec of records) {
      if (!rec.customerEmail) continue;

      const expiresDay = dayjs(rec.expiresAt).tz('America/Sao_Paulo').startOf('day');
      const daysRemaining = expiresDay.diff(todayLocal, 'day');
      const planName = this.platformAccess.platformLabel(rec.platformTag);

      // Aviso "vai vencer": 3, 2 e 1 dias antes (ainda com acesso; dizem "vence em X dias").
      // No dia do vencimento não avisa — há 1 dia de tolerância e o email de "expirou/renove"
      // sai no bloqueio (dia seguinte), evitando email duplicado de expiração.
      if (daysRemaining >= 1 && daysRemaining <= 3) {
        try {
          const renewUrl = await this.platformAccess.resolveRenewUrl(rec.platformTag, rec.customerEmail);
          await this.email.sendExpirationReminder({
            to: rec.customerEmail,
            customerName: rec.customerName || 'Cliente',
            planName,
            expiresAt: rec.expiresAt,
            daysRemaining,
            renewUrl,
          });
          this.logger.log(`[PlatformAccessReminder] aviso enviado ${rec.customerEmail} (${rec.platformTag}) — ${daysRemaining}d`);
        } catch (err: unknown) {
          this.logger.error(`[PlatformAccessReminder] falha no aviso ${rec.customerEmail}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Vencido com 1 dia de tolerância (venceu ontem ou antes) → bloqueia + email de renovação
      if (daysRemaining <= -1) {
        try {
          await this.platformAccess.setSaasUserActive(rec.platformTag, rec.customerEmail, false);
          await this.prisma.platformSubscriberAccess.update({
            where: { id: rec.id },
            data: { isActive: false },
          });
          const renewUrl = await this.platformAccess.resolveRenewUrl(rec.platformTag, rec.customerEmail);
          await this.email.sendExpirationReminder({
            to: rec.customerEmail,
            customerName: rec.customerName || 'Cliente',
            planName,
            expiresAt: rec.expiresAt,
            daysRemaining: 0, // <= 0 → o template trata como expirado
            renewUrl,
          });
          this.logger.log(`[PlatformAccessReminder] acesso bloqueado + email de renovação ${rec.customerEmail} (${rec.platformTag})`);
        } catch (err: unknown) {
          this.logger.error(`[PlatformAccessReminder] falha ao bloquear ${rec.customerEmail}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  private async processPixPlans() {
    const todayLocal = dayjs().tz('America/Sao_Paulo').startOf('day');

    const activePlans = await this.prisma.customerPlanAccess.findMany({
      where: { isActive: true },
      include: {
        customer: true,
        user: true,
        pixPlan: { include: { linkCodes: true } },
      },
    });

    for (const plan of activePlans) {
      if (!plan.customer?.email) continue;

      const expiresDay = dayjs(plan.expiresAt).tz('America/Sao_Paulo').startOf('day');
      const daysRemaining = expiresDay.diff(todayLocal, 'day');

      if (daysRemaining === 3 || daysRemaining === 2 || daysRemaining === 1 || daysRemaining === 0) {
        const linkCode = plan.pixPlan?.linkCodes?.[0]?.code;
        const renewUrl = linkCode ? `https://paga-tg.com/checkout/${linkCode}` : undefined;

        try {
          await this.email.sendExpirationReminder({
            to: plan.customer.email,
            customerName: plan.customer.name || 'Cliente',
            vendedorName: plan.user?.name || undefined,
            planName: plan.pixPlan?.description || plan.pixPlanCode || 'Plano PIX',
            expiresAt: plan.expiresAt,
            daysRemaining,
            renewUrl,
          });
          this.logger.log(`[ExpirationReminder] Email enviado para ${plan.customer.email} — ${daysRemaining} dia(s) restante(s)`);
        } catch (err: unknown) {
          this.logger.error(`[ExpirationReminder] Falha ao enviar email para ${plan.customer.email}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  private async processCcSubscriptions() {
    const todayLocal = dayjs().tz('America/Sao_Paulo').startOf('day');

    const subscriptions = await this.prisma.subscription.findMany({
      where: { status: 'active', expiresAt: { not: null } },
      include: { customer: true, user: true, plan: true },
    });

    for (const sub of subscriptions) {
      if (!sub.customer?.email || !sub.expiresAt) continue;

      const expiresDay = dayjs(sub.expiresAt).tz('America/Sao_Paulo').startOf('day');
      const daysRemaining = expiresDay.diff(todayLocal, 'day');

      if (daysRemaining === 3 || daysRemaining === 2 || daysRemaining === 1 || daysRemaining === 0) {
        const renewUrl = sub.plan?.code
          ? `https://paga-tg.com/checkout-sub/${sub.plan.code}`
          : undefined;

        try {
          await this.email.sendExpirationReminder({
            to: sub.customer.email,
            customerName: sub.customer.name || 'Assinante',
            vendedorName: sub.user?.name || undefined,
            planName: sub.plan?.description || 'Assinatura',
            expiresAt: sub.expiresAt,
            daysRemaining,
            renewUrl,
          });
          this.logger.log(`[ExpirationReminder] Email de assinatura enviado para ${sub.customer.email} — ${daysRemaining} dia(s) restante(s)`);
        } catch (err: unknown) {
          this.logger.error(`[ExpirationReminder] Falha ao enviar email de assinatura para ${sub.customer.email}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
}
