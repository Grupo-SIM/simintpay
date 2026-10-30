import { TransactionStatus } from '@prisma/client';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  CircuitOpenException,
  CircuitUnavailableException,
} from '../../../infrastructure/resilience/payment-circuit-breaker';

export type ChargeOutcome = {
  safeToRetry: boolean;
  evidenceType: 'pre_dispatch' | 'provider_no_charge' | 'ambiguous';
  requestDispatched: boolean | null;
  provider?: 'DOM' | 'FRENDZ';
  httpStatus?: number;
  providerCode?: string;
};

const evidence = new WeakMap<object, ChargeOutcome>();

/** Only call before the charge request can reach the acquirer (e.g. an open breaker). */
export function markPreDispatchNoCharge<T extends object>(error: T): T {
  evidence.set(error, {
    safeToRetry: true,
    evidenceType: 'pre_dispatch',
    requestDispatched: false,
  });
  return error;
}

/** Retain provider diagnostics without retaining payloads or treating HTTP status as no-charge proof. */
export function markChargeAttempt<T extends object>(
  error: T,
  details: Pick<ChargeOutcome, 'provider' | 'httpStatus' | 'providerCode'>,
): T {
  evidence.set(error, {
    safeToRetry: false,
    evidenceType: 'ambiguous',
    requestDispatched: true,
    ...details,
  });
  return error;
}

/**
 * A provider refusal can be marked definitive only when a documented provider
 * contract explicitly guarantees that this particular response created no charge.
 * No such DOM response contract is currently verified; HTTP 400/401/422 alone
 * must never be used as this evidence.
 */
export function markDefinitiveDomRejection<T extends object>(error: T): T {
  evidence.set(error, {
    safeToRetry: true,
    evidenceType: 'provider_no_charge',
    requestDispatched: true,
    provider: 'DOM',
  });
  return error;
}

export function classifyChargeOutcome(error: unknown): ChargeOutcome {
  if (
    error instanceof CircuitOpenException ||
    error instanceof CircuitUnavailableException
  )
    return {
      safeToRetry: true,
      evidenceType: 'pre_dispatch',
      requestDispatched: false,
    };
  if (typeof error !== 'object' || error === null)
    return {
      safeToRetry: false,
      evidenceType: 'ambiguous',
      requestDispatched: null,
    };
  const marked = evidence.get(error);
  if (marked) return marked;
  const candidate = error as {
    isAxiosError?: boolean;
    response?: { status?: unknown; data?: unknown };
  };
  if (candidate.isAxiosError === true) {
    const status = candidate.response?.status;
    const data = candidate.response?.data;
    const code =
      data && typeof data === 'object' && 'code' in data
        ? data.code
        : undefined;
    return {
      safeToRetry: false,
      evidenceType: 'ambiguous',
      requestDispatched: null,
      ...(typeof status === 'number' ? { httpStatus: status } : {}),
      ...(typeof code === 'string' ? { providerCode: code } : {}),
    };
  }
  return {
    safeToRetry: false,
    evidenceType: 'ambiguous',
    requestDispatched: null,
  };
}

export function isDefinitiveDomRejection(error: unknown): boolean {
  const outcome = classifyChargeOutcome(error);
  return (
    outcome.evidenceType === 'provider_no_charge' && outcome.provider === 'DOM'
  );
}

/** Retained for legacy callers; status alone cannot establish a no-charge result. */
export function isDefinitiveDomStatus(status: number): boolean {
  return status < 0;
}

/** Discard only when an explicit, verified no-charge result was recorded. */
export async function discardDraftOnRejection<T>(
  prisma: Pick<PrismaService, 'transaction'>,
  transactionId: string,
  charge: () => Promise<T>,
): Promise<T> {
  try {
    return await charge();
  } catch (error) {
    if (classifyChargeOutcome(error).safeToRetry)
      await prisma.transaction.deleteMany({
        where: { id: transactionId, status: TransactionStatus.DRAFT },
      });
    throw error;
  }
}
