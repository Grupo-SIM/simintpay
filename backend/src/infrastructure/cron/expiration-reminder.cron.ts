import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma/prisma.service';
import { EmailService } from '../email/email.service';
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
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleCron() {
    this.logger.log('Iniciando cron de lembrete de expiração de planos...');

    await Promise.all([this.processPixPlans(), this.processCcSubscriptions()]);

    this.logger.log('Cron de lembrete de expiração concluído.');
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

      const expiresDay = dayjs(plan.expiresAt)
        .tz('America/Sao_Paulo')
        .startOf('day');
      const daysRemaining = expiresDay.diff(todayLocal, 'day');

      if (
        daysRemaining === 3 ||
        daysRemaining === 2 ||
        daysRemaining === 1 ||
        daysRemaining === 0
      ) {
        const linkCode = plan.pixPlan?.linkCodes?.[0]?.code;
        const renewUrl = linkCode
          ? `https://paga-tg.com/checkout/${linkCode}`
          : undefined;

        try {
          await this.email.sendExpirationReminder({
            to: plan.customer.email,
            customerName: plan.customer.name || 'Cliente',
            vendedorName: plan.user?.name || undefined,
            planName:
              plan.pixPlan?.description || plan.pixPlanCode || 'Plano PIX',
            expiresAt: plan.expiresAt,
            daysRemaining,
            renewUrl,
          });
          this.logger.log(
            `[ExpirationReminder] Email enviado para ${plan.customer.email} — ${daysRemaining} dia(s) restante(s)`,
          );
        } catch (err: unknown) {
          this.logger.error(
            `[ExpirationReminder] Falha ao enviar email para ${plan.customer.email}: ${err instanceof Error ? err.message : String(err)}`,
          );
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

      const expiresDay = dayjs(sub.expiresAt)
        .tz('America/Sao_Paulo')
        .startOf('day');
      const daysRemaining = expiresDay.diff(todayLocal, 'day');

      if (
        daysRemaining === 3 ||
        daysRemaining === 2 ||
        daysRemaining === 1 ||
        daysRemaining === 0
      ) {
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
          this.logger.log(
            `[ExpirationReminder] Email de assinatura enviado para ${sub.customer.email} — ${daysRemaining} dia(s) restante(s)`,
          );
        } catch (err: unknown) {
          this.logger.error(
            `[ExpirationReminder] Falha ao enviar email de assinatura para ${sub.customer.email}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
}
