import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { OfferAccessReminderService } from './offer-access-reminder.service';
import { OfferAccessService } from './offer-access.service';

const LOCK_KEY = 'offer-access:daily';

@Injectable()
export class OfferAccessCron {
  private readonly logger = new Logger(OfferAccessCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OfferAccessService,
    private readonly reminders: OfferAccessReminderService,
  ) {}

  /** Expira os créditos vencidos (e avisa o PAGATG). Idempotente, então roda de hora em hora. */
  @Cron(CronExpression.EVERY_HOUR)
  async expire(): Promise<void> {
    await this.locked('expire', async () => {
      const missed = await this.access.creditMissed(new Date());
      if (missed.credited)
        this.logger.warn(
          `Créditos atrasados aplicados: ${JSON.stringify(missed)}`,
        );
      const result = await this.access.decrementAll(new Date());
      this.logger.log(
        `Acessos: processados=${result.processed} expirados=${result.expired} erros=${result.errors}`,
      );
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'America/Sao_Paulo' })
  async remind(): Promise<void> {
    await this.locked('remind', async () => {
      const result = await this.reminders.run(new Date());
      this.logger.log(`Lembretes de acesso: ${JSON.stringify(result)}`);
    });
  }

  /** Lock de transação (como no BillingCycleCron): só uma réplica executa por vez. */
  private async locked(name: string, work: () => Promise<void>): Promise<void> {
    try {
      const ran = await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtextextended(${`${LOCK_KEY}:${name}`}, 0)) AS locked`;
          if (!rows[0]?.locked) return false;
          await work();
          return true;
        },
        { timeout: 10 * 60 * 1000, maxWait: 10_000 },
      );
      if (!ran)
        this.logger.log(`Outra réplica já executa "${name}"; ignorando.`);
    } catch (error) {
      this.logger.error(
        `Falha no cron de acessos (${name}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
