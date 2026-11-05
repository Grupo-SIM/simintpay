import { Injectable, Logger } from '@nestjs/common';
import { resolveCycleDomToken } from './cycle-dom-token';
import { Acquirer, toAcquirer } from '../../core/services/acquirer.enum';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PaymentGatewayResolver } from '../../infrastructure/http/payment-gateway.resolver';
import {
  outcomeFromGatewayStatus,
  StoredCardCycleExecutor,
} from './stored-card-cycle.executor';

export const CHARGE_STATUS_LOOKUP = Symbol('CHARGE_STATUS_LOOKUP');

/**
 * PAID/FAILED: the acquirer has a final answer. NOT_FOUND: the acquirer has no transaction for
 * that attempt's idempotency key. UNKNOWN: could not be determined (outage, unsupported lookup).
 */
export type ChargeLookupResult = 'PAID' | 'FAILED' | 'NOT_FOUND' | 'UNKNOWN';

/** Asks the acquirer what happened to attempt `attempts` of a cycle charge (cod_external `cycle:<chargeId>:<attempts>`). */
export interface ChargeStatusLookup {
  find(chargeId: string, attempts: number): Promise<ChargeLookupResult>;
}

/** Transactions per page requested from DOM. */
export const LOOKUP_PAGE_SIZE = 100;
/** Hard cap on pages scanned per lookup (never loop unbounded): at most 10 x 100 transactions. */
export const LOOKUP_MAX_PAGES = 10;
/** Lookback window. An attempt older than this cannot be searched, so the answer is UNKNOWN. */
export const LOOKUP_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * DOM implementation. DOM's `GET /transactions` has no documented `cod_external` filter, so it
 * pages through the owner's recent transactions (`begin_date` = day before the attempt, i.e.
 * the charge's last update, through today) and matches `cod_external` locally against
 * `cycle:<chargeId>:<attempts>`. Status mapping is the executor's `outcomeFromGatewayStatus`.
 *
 * NOT_FOUND is only returned when the whole window was scanned (a short page ended the
 * listing). Any API error, the page cap, a window older than LOOKUP_WINDOW_DAYS, a missing
 * token or a non-DOM acquirer is UNKNOWN, never NOT_FOUND.
 */
@Injectable()
export class DomChargeStatusLookup implements ChargeStatusLookup {
  private readonly logger = new Logger(DomChargeStatusLookup.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewayResolver,
  ) {}

  async find(
    chargeId: string,
    attempts: number,
    now: Date = new Date(),
  ): Promise<ChargeLookupResult> {
    try {
      const charge = await this.prisma.charge.findUnique({
        where: { id: chargeId },
        select: {
          updatedAt: true,
          contract: { select: { acquirer: true, userId: true } },
        },
      });
      if (!charge?.contract) return 'UNKNOWN';
      if (toAcquirer(charge.contract.acquirer) !== Acquirer.DOM)
        return 'UNKNOWN';
      // Same account the cycle charge was issued with; undefined/throw -> UNKNOWN, never NOT_FOUND.
      const token = await resolveCycleDomToken(
        this.prisma,
        charge.contract.userId,
      );
      if (!token) return 'UNKNOWN';

      const begin = new Date(charge.updatedAt.getTime() - DAY_MS);
      if (begin.getTime() < now.getTime() - LOOKUP_WINDOW_DAYS * DAY_MS)
        return 'UNKNOWN';

      const key = StoredCardCycleExecutor.idempotencyKey({
        id: chargeId,
        attempts,
      });
      const gateway = this.gateways.byAcquirer(Acquirer.DOM);
      for (let page = 1; page <= LOOKUP_MAX_PAGES; page++) {
        const { transactions } = await gateway.listDomTransactions(token, {
          page,
          limit: LOOKUP_PAGE_SIZE,
          begin_date: ymd(begin),
          end_date: ymd(new Date(now.getTime() + DAY_MS)),
        });
        const match = transactions.find((tx) => tx.cod_external === key);
        if (match) return outcomeFromGatewayStatus(match.status ?? '');
        if (transactions.length < LOOKUP_PAGE_SIZE) return 'NOT_FOUND';
      }
      this.logger.warn(
        `Cobrança ${chargeId}: ${LOOKUP_MAX_PAGES} páginas da DOM sem encontrar ${key}; mantida UNKNOWN`,
      );
      return 'UNKNOWN';
    } catch (error) {
      this.logger.warn(
        `Consulta DOM da cobrança ${chargeId} falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'UNKNOWN';
    }
  }
}
