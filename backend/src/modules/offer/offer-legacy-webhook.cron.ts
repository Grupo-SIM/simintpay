import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { OfferFulfillmentService } from './offer-fulfillment.service';

const LIMIT = 200;

/**
 * Looks for recurring-offer contracts whose access ended (cancelled and past `accessEndsAt`,
 * suspended, or finished) and tells the offer webhook once per paid cycle. Retries on the next
 * run when the receiver is down: the marker on the last paid Charge is released on failure.
 */
@Injectable()
export class OfferLegacyWebhookCron {
  private readonly logger = new Logger(OfferLegacyWebhookCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: OfferFulfillmentService,
  ) {}

  @Interval(5 * 60 * 1000)
  async run(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT c."id" FROM "BillingContract" c
        JOIN "Offer" o ON o."id" = c."offerId"
        WHERE o."renewalMode" <> 'NONE'
          AND o."metadata"->>'webhookUrl' IS NOT NULL
          AND (
            (c."status" = 'CANCELLED' AND (c."accessEndsAt" IS NULL OR c."accessEndsAt" <= ${now}))
            OR c."status" = 'SUSPENDED'
            OR (c."status" = 'INACTIVE' AND c."currentPeriodEnd" <= ${now})
          )
          AND EXISTS (
            SELECT 1 FROM "Charge" ch
            WHERE ch."id" = (
              SELECT l."id" FROM "Charge" l
              WHERE l."contractId" = c."id" AND l."status" = 'PAID'
              ORDER BY l."paidAt" DESC NULLS LAST, l."createdAt" DESC, l."id" DESC LIMIT 1
            ) AND ch."snapshot" #> ARRAY['fulfillment', 'webhookExpired']::text[] IS NULL
          )
        LIMIT ${LIMIT}`;
      for (const row of rows) {
        try {
          await this.fulfillment.notifyContractExpired(row.id);
        } catch (err: unknown) {
          this.logger.error(
            `Falha ao avisar a expiração do contrato ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return rows.length;
    } catch (err: unknown) {
      this.logger.error(
        `Falha na varredura de assinaturas expiradas: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}
