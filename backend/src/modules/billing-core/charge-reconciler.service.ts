import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { BillingCycleService } from './billing-cycle.service';
import {
  CHARGE_STATUS_LOOKUP,
  type ChargeLookupResult,
  type ChargeStatusLookup,
} from './charge-status-lookup';

const HOUR = 60 * 60 * 1000;
/** Do not second-guess an attempt that may still be in flight. */
export const RECONCILE_MIN_AGE_MS = 15 * 60 * 1000;
/** NOT_FOUND right after the attempt may only be acquirer lag; wait before treating it as never charged. */
export const NOT_FOUND_GRACE_MS = HOUR;
/** Still UNKNOWN after this long: a human must look at it. */
export const UNRESOLVED_AFTER_MS = 48 * HOUR;

export type ReconcileResult = {
  checked: number;
  paid: number;
  failed: number;
  stillUnknown: number;
  flagged: number;
};

/**
 * Resolves AUTO_CHARGE charges left PENDING by an UNKNOWN executor outcome by asking the acquirer
 * (through an injectable port) and settling through `BillingCycleService.settle`, which is
 * idempotent. Never settles on a guess: UNKNOWN keeps the charge PENDING.
 */
@Injectable()
export class ChargeReconciler {
  private readonly logger = new Logger(ChargeReconciler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cycles: BillingCycleService,
    @Inject(CHARGE_STATUS_LOOKUP) private readonly lookup: ChargeStatusLookup,
  ) {}

  async run(now: Date = new Date()): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      checked: 0,
      paid: 0,
      failed: 0,
      stillUnknown: 0,
      flagged: 0,
    };
    const pending = await this.prisma.charge.findMany({
      where: {
        status: 'PENDING',
        contractId: { not: null },
        attempts: { gt: 0 },
        dueAt: { lte: new Date(now.getTime() - RECONCILE_MIN_AGE_MS) },
        contract: { offer: { renewalMode: 'AUTO_CHARGE' } },
      },
      orderBy: { dueAt: 'asc' },
      take: 200,
    });
    for (const charge of pending) {
      result.checked++;
      const ageMs = now.getTime() - (charge.dueAt ?? now).getTime();
      let found: ChargeLookupResult;
      try {
        found = await this.lookup.find(charge.id, charge.attempts);
      } catch (error) {
        this.logger.warn(
          `Consulta da cobrança ${charge.id} falhou: ${error instanceof Error ? error.message : String(error)}`,
        );
        found = 'UNKNOWN';
      }
      try {
        if (found === 'PAID') {
          await this.cycles.settle(charge.id, 'PAID', now);
          result.paid++;
          continue;
        }
        if (found === 'FAILED') {
          await this.cycles.settle(charge.id, 'FAILED', now);
          result.failed++;
          continue;
        }
        if (found === 'NOT_FOUND' && ageMs >= NOT_FOUND_GRACE_MS) {
          // The attempt's idempotency key never reached the acquirer: safe to fail it and let
          // the retry policy open a new attempt (new key).
          await this.cycles.settle(charge.id, 'FAILED', now);
          result.failed++;
          continue;
        }
      } catch (error) {
        // e.g. ledger booking failed; the claim rolled back and the charge stays PENDING.
        this.logger.error(
          `Liquidação da cobrança ${charge.id} falhou: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      result.stillUnknown++;
      if (ageMs >= UNRESOLVED_AFTER_MS && charge.contractId) {
        const eventKey = `charge-unresolved:${charge.id}:${charge.attempts}`;
        const exists = await this.prisma.billingContractEvent.findUnique({
          where: { eventKey },
          select: { id: true },
        });
        if (exists) continue;
        await this.prisma.billingContractEvent.create({
          data: {
            contractId: charge.contractId,
            eventKey,
            type: 'CHARGE_UNRESOLVED',
            payload: {
              chargeId: charge.id,
              attempts: charge.attempts,
              amountCents: charge.amountCents,
              pendingSince: charge.dueAt?.toISOString() ?? null,
            },
          },
        });
        result.flagged++;
      }
    }
    return result;
  }
}
