import type { Prisma } from '@prisma/client';

type BillingMetadata = {
  platformTag?: unknown;
};

export function getBillingPlatformTag(
  metadata: Prisma.JsonValue | null | undefined,
): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const tag = (metadata as BillingMetadata).platformTag;
  return typeof tag === 'string' && tag.trim()
    ? tag.trim().toUpperCase()
    : null;
}

export function buildBillingTransactionDescription(
  description: string | null | undefined,
  metadata: Prisma.JsonValue | null | undefined,
): string | null {
  const platformTag = getBillingPlatformTag(metadata);
  const base = description?.trim() || 'Cobrança recorrente';
  if (!platformTag || platformTag === 'GLOBAL') return description?.trim() || null;
  if (/\[TENANT:[^\]]+\]/i.test(base)) return base;
  return `${base} [TENANT:${platformTag}]`;
}
