import { TransactionStatus } from '@prisma/client';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

/** DOM statuses meaning the request was refused before any transaction existed there. */
const DEFINITIVE_DOM_STATUSES = new Set([400, 401, 422]);
const definitiveRejections = new WeakSet<object>();

/** Flags an error as a definitive DOM refusal without changing its class or response. */
export function markDefinitiveDomRejection<T extends object>(error: T): T {
  definitiveRejections.add(error);
  return error;
}

export function isDefinitiveDomRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (definitiveRejections.has(error)) return true;
  const ax = error as {
    isAxiosError?: boolean;
    response?: { status?: number };
  };
  return (
    ax.isAxiosError === true &&
    DEFINITIVE_DOM_STATUSES.has(ax.response?.status ?? 0)
  );
}

export function isDefinitiveDomStatus(status: number) {
  return DEFINITIVE_DOM_STATUSES.has(status);
}

/**
 * Runs a DOM charge for a reserved DRAFT. A definitive refusal means DOM never
 * created the transaction, so the draft is discarded. Timeouts, network errors
 * and 5xx are uncertain and keep the draft for reconciliation.
 */
export async function discardDraftOnRejection<T>(
  prisma: Pick<PrismaService, 'transaction'>,
  transactionId: string,
  charge: () => Promise<T>,
): Promise<T> {
  try {
    return await charge();
  } catch (error) {
    if (isDefinitiveDomRejection(error))
      await prisma.transaction.deleteMany({
        where: { id: transactionId, status: TransactionStatus.DRAFT },
      });
    throw error;
  }
}
