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

/** Hard cap on pages scanned per lookup (never loop unbounded). */
export const LOOKUP_MAX_PAGES = 10;
/** Lookback window. An attempt older than this cannot be fully searched. */
export const LOOKUP_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * DOM implementation. DOM's `GET /transactions` has no documented `cod_external` filter and no
 * page-size request parameter, so it pages through the owner's transactions created in the
 * window (`type_date=created`, `begin_date` = day before the charge was created, through
 * tomorrow) and matches `cod_external` locally against `cycle:<chargeId>:<attempts>`. Page size
 * and total come from the RESPONSE (`per_page`, `total`). Status mapping is the executor's
 * `outcomeFromGatewayStatus`.
 *
 * `created` (not `updated`) is used because a transaction's creation date is fixed by the
 * attempt, while an `updated` window shifts whenever DOM touches the transaction. The charge's
 * creation date is a lower bound for every attempt; if it is older than LOOKUP_WINDOW_DAYS the
 * window is truncated to the last LOOKUP_WINDOW_DAYS days: a match is still reported, but a miss
 * is UNKNOWN because earlier transactions were not scanned.
 *
 * NOT_FOUND is only returned when the whole window was scanned and the response's own
 * `total`/`per_page` say so. Any API error, anomaly (missing or inconsistent total/per_page),
 * the page cap, a missing token or a non-DOM acquirer is UNKNOWN, never NOT_FOUND.
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
          createdAt: true,
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

      const idealBegin = charge.createdAt.getTime() - DAY_MS;
      const windowStart = now.getTime() - LOOKUP_WINDOW_DAYS * DAY_MS;
      const truncated = idealBegin < windowStart;
      const begin = new Date(truncated ? windowStart : idealBegin);
      const exhausted: ChargeLookupResult = truncated ? 'UNKNOWN' : 'NOT_FOUND';

      const key = StoredCardCycleExecutor.idempotencyKey({
        id: chargeId,
        attempts,
      });
      const gateway = this.gateways.byAcquirer(Acquirer.DOM);
      for (let page = 1; page <= LOOKUP_MAX_PAGES; page++) {
        const result = await gateway.listDomTransactions(token, {
          page,
          begin_date: ymd(begin),
          end_date: ymd(new Date(now.getTime() + DAY_MS)),
          type_date: 'created',
        });
        const { transactions } = result;
        const match = transactions.find((tx) => tx.cod_external === key);
        if (match) return outcomeFromGatewayStatus(match.status ?? '');

        const perPage = result.per_page;
        const total = result.reported_total;
        if (typeof total !== 'number' || total < 0) {
          return this.anomaly(chargeId, 'resposta sem total');
        }
        if (transactions.length === 0) {
          // An empty page ends the listing only if the total agrees nothing is left.
          const pending =
            typeof perPage === 'number' && perPage > 0
              ? (page - 1) * perPage < total
              : page === 1 && total > 0;
          return pending
            ? this.anomaly(chargeId, 'página vazia com total pendente')
            : exhausted;
        }
        if (typeof perPage !== 'number' || !(perPage > 0)) {
          return this.anomaly(chargeId, 'resposta sem per_page');
        }
        if (page * perPage >= total) {
          // Last page: it must hold exactly what the total says is left.
          return transactions.length === total - (page - 1) * perPage
            ? exhausted
            : this.anomaly(chargeId, 'total inconsistente com a página');
        }
        if (transactions.length !== perPage) {
          return this.anomaly(chargeId, 'página curta com total pendente');
        }
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

  private anomaly(chargeId: string, reason: string): ChargeLookupResult {
    this.logger.warn(
      `Cobrança ${chargeId}: listagem DOM anômala (${reason}); UNKNOWN`,
    );
    return 'UNKNOWN';
  }
}
