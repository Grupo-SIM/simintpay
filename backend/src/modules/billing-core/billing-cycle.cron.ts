import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { BillingCycleService } from './billing-cycle.service';
import { ChargeDueDeliveryService } from './charge-due-delivery.service';

const LOCK_KEY = 'billing-cycle:run-due';

@Injectable()
export class BillingCycleCron {
  private readonly logger = new Logger(BillingCycleCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cycles: BillingCycleService,
    private readonly delivery: ChargeDueDeliveryService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    try {
      // Lock de transação: liberado no fim (ou se o processo cair), sem depender da conexão do pool.
      const ran = await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) AS locked`;
          if (!rows[0]?.locked) return false;
          // Sem executor de cartão ainda: contratos AUTO_CHARGE são ignorados.
          const result = await this.cycles.runDue(new Date(), undefined, {
            skipAutoChargeWithoutExecutor: true,
          });
          const delivery = await this.delivery.deliverPending();
          this.logger.log(
            `Ciclos: ${JSON.stringify(result)}; entregas CHARGE_DUE: ${JSON.stringify(delivery)}`,
          );
          return true;
        },
        { timeout: 10 * 60 * 1000, maxWait: 10_000 },
      );
      if (!ran)
        this.logger.log('Outra réplica já executa os ciclos; ignorando.');
    } catch (error) {
      this.logger.error(
        `Falha no cron de ciclos: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
