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
    
    await Promise.all([
      this.processPixPlans(),
      this.processCcSubscriptions(),
    ]);

    this.logger.log('Cron de lembrete de expiração concluído.');
  }

  private async processPixPlans() {
    const nowLocal = dayjs().tz('America/Sao_Paulo');
    
    const activePlans = await this.prisma.customerPlanAccess.findMany({
      where: {
        isActive: true,
      },
      include: {
        customer: true,
        user: true, // Adicionado para pegar o nome do vendedor
        pixPlan: {
          include: {
            linkCodes: true,
          },
        },
      },
    });

    for (const plan of activePlans) {
      if (!plan.customer?.email) continue;

      const expiresAt = dayjs(plan.expiresAt).tz('America/Sao_Paulo');
      const daysRemaining = Math.ceil(expiresAt.diff(nowLocal, 'day', true));

      if (daysRemaining === 2 || daysRemaining === 1 || daysRemaining === 0) {
        // Buscar o código de checkout para renovação
        const linkCode = plan.pixPlan?.linkCodes?.[0]?.code;
        const renewUrl = linkCode ? `https://paga-tg.com/checkout/${linkCode}` : undefined;

        await this.email.sendExpirationReminder({
          to: plan.customer.email,
          customerName: plan.customer.name || 'Cliente',
          vendedorName: plan.user?.name || undefined,
          planName: plan.pixPlan?.description || plan.pixPlanCode || 'Plano PIX',
          expiresAt: plan.expiresAt,
          daysRemaining: daysRemaining,
          renewUrl: renewUrl,
        });
      }
    }
  }

  private async processCcSubscriptions() {
    const nowLocal = dayjs().tz('America/Sao_Paulo');

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'active',
        expiresAt: { not: null },
      },
      include: {
        customer: true,
        user: true, // Adicionado para pegar o nome do vendedor
        plan: true,
      },
    });

    for (const sub of subscriptions) {
      if (!sub.customer?.email || !sub.expiresAt) continue;

      const expiresAt = dayjs(sub.expiresAt).tz('America/Sao_Paulo');
      const daysRemaining = Math.ceil(expiresAt.diff(nowLocal, 'day', true));

      if (daysRemaining === 2 || daysRemaining === 1 || daysRemaining === 0) {
        // Para assinaturas, o Plano tem um campo 'code'
        const renewUrl = sub.plan?.code
          ? `https://paga-tg.com/checkout-sub/${sub.plan.code}`
          : undefined;

        await this.email.sendExpirationReminder({
          to: sub.customer.email,
          customerName: sub.customer.name || 'Assinante',
          vendedorName: sub.user?.name || undefined,
          planName: sub.plan?.description || 'Assinatura',
          expiresAt: sub.expiresAt,
          daysRemaining: daysRemaining,
          renewUrl: renewUrl,
        });
      }
    }
  }
}
