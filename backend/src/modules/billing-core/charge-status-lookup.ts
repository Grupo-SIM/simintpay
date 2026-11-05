import { Injectable } from '@nestjs/common';

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

/**
 * DOM implementation: NOT IMPLEMENTED. `ApiDomClient` only reads a transaction by DOM id
 * (`getDomTransactionDetail`) and its list endpoint has no `cod_external` filter, so there is
 * no suitable lookup by our idempotency key yet. Always UNKNOWN, which keeps the charge PENDING
 * and lets it be flagged CHARGE_UNRESOLVED after 48h. Replace once DOM exposes the lookup.
 */
@Injectable()
export class DomChargeStatusLookup implements ChargeStatusLookup {
  async find(): Promise<ChargeLookupResult> {
    return 'UNKNOWN';
  }
}
