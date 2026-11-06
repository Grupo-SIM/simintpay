import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { RenewalReminderService } from './renewal-reminder.service';

const LOCK_KEY = 'billing-cycle:renewal-reminder';

@Injectable()
export class RenewalReminderCron {
  private readonly logger = new Logger(RenewalReminderCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RenewalReminderService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'America/Sao_Paulo' })
  async handleCron(): Promise<void> {
    try {
      // Lock de transação, como no BillingCycleCron: só uma réplica envia por vez.
      const ran = await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) AS locked`;
          if (!rows[0]?.locked) return false;
          const result = await this.reminders.run(new Date());
          this.logger.log(`Lembretes de renovação: ${JSON.stringify(result)}`);
          return true;
        },
        { timeout: 10 * 60 * 1000, maxWait: 10_000 },
      );
      if (!ran)
        this.logger.log('Outra réplica já envia os lembretes; ignorando.');
    } catch (error) {
      this.logger.error(
        `Falha no cron de lembretes de renovação: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
