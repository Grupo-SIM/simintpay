import { TransactionStatus } from '@prisma/client';

export interface PlatformSyncAdapter {
  /** Only adapters with a DOM-direct token can poll the acquirer; others only classify descriptions. */
  directSync: boolean;
  grossWallet: boolean;
  accepts(description: string): boolean;
}
const adapters: Record<string, PlatformSyncAdapter> = {
  ATLAS: {
    directSync: true,
    grossWallet: true,
    accepts: (description) => /atlas/i.test(description),
  },
  REVALIDA: {
    directSync: true,
    grossWallet: true,
    accepts: (description) => /revalida/i.test(description),
  },
  BOSQUE: { directSync: false, grossWallet: false, accepts: () => true },
  RENOVADA: {
    directSync: false,
    grossWallet: true,
    accepts: (description) =>
      !description.startsWith('PIX_PLAN_CODE:') &&
      /d[ií]zimo|prim[ií]cia|oferta|funda[cç][aã]o|maquineta|terminal/i.test(
        description,
      ),
  },
};

export function platformSyncAdapter(
  tag: string,
): PlatformSyncAdapter | undefined {
  return adapters[tag];
}

/** Unknown provider states must never turn settled money back into a pending payment. */
export function syncStatus(value: unknown): TransactionStatus | null {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  if (['paid', 'approved', 'completed'].includes(raw))
    return TransactionStatus.COMPLETED;
  if (
    [
      'refused',
      'canceled',
      'cancelled',
      'failed',
      'error',
      'not_authorized',
    ].includes(raw)
  )
    return TransactionStatus.FAILED;
  if (['pending', 'waiting', 'waiting_payment', 'authorized'].includes(raw))
    return TransactionStatus.PENDING;
  if (raw === 'refunded') return TransactionStatus.REFUNDED;
  if (raw === 'expired') return TransactionStatus.EXPIRED;
  if (raw === 'chargeback') return TransactionStatus.CHARGEBACK;
  return null;
}

export function canSyncTransition(
  from: TransactionStatus,
  to: TransactionStatus,
): boolean {
  if (from === 'PENDING' || from === 'DRAFT')
    return ['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'].includes(to);
  if (from === 'COMPLETED')
    return ['REFUNDED', 'CHARGEBACK', 'IN_MEDIATION'].includes(to);
  return false;
}

export function hasPlatformMarker(
  description: string | null,
  tag: string,
): boolean {
  const tags = [...(description ?? '').matchAll(/\[TENANT:([^\]]+)\]/gi)].map(
    (match) => match[1].toUpperCase().replaceAll('_', '-'),
  );
  return tags.length > 0 && tags.every((value) => value === tag);
}

/** Explicit platform markers take precedence over legacy product-name heuristics. */
export function acceptsPlatformSyncDescription(
  description: string,
  tag: string,
): boolean {
  if (/\[TENANT:/i.test(description))
    return hasPlatformMarker(description, tag);
  return platformSyncAdapter(tag)?.accepts(description) ?? false;
}

export function conflictingPlatformMarker(
  description: string,
  tag: string,
): boolean {
  return /\[TENANT:/i.test(description) && !hasPlatformMarker(description, tag);
}
