/**
 * Shared pure rules for the product ownership audit and reassignment scripts.
 * Plan 0009: a product belongs to a non-administrative owner; a registered platform's owner is the
 * only inferable target. Names, e-mails and descriptions are never evidence.
 */
import { createHash } from 'node:crypto';

export const PRODUCT_TYPES = [
  'PaymentLink',
  'SubscriptionLink',
  'Plan',
  'PixCreditPlan',
  'Boleto',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export type OwnerFacts = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  isPurged: boolean;
  hasDocument: boolean;
};
export type PlatformFacts = {
  tag: string;
  isActive: boolean;
  ownerUserId: string;
};
export type ProductFacts = {
  type: ProductType;
  id: string;
  title: string | null;
  owner: OwnerFacts | null;
  createdByUserId: string | null;
  tags: string[];
  /** The agreement participants (accounts) or null when the product has no private agreement. */
  agreement: { id: string; email: string; role: string }[] | null;
};

export type Classification =
  | { status: 'OK' }
  | {
      status: 'PROPOSE_TRANSFER';
      targetUserId: string;
      evidence: string;
    }
  | { status: 'NEEDS_DECISION'; reasons: string[] };

const NEUTRAL_TAGS = new Set(['GLOBAL', 'SIMINTPAY']);

export function normalizeTag(tag: string): string {
  const t = tag.trim().toUpperCase().replaceAll('_', '-');
  return t === 'EBOOKSIM' ? 'EBOOK' : t;
}

/** Distinct, sorted, platform-bound tags from every legacy tag field. */
export function normalizeTags(
  ...sources: (string | string[] | null | undefined)[]
): string[] {
  const out = new Set<string>();
  for (const source of sources) {
    for (const raw of Array.isArray(source) ? source : [source]) {
      if (!raw || !raw.trim()) continue;
      const tag = normalizeTag(raw);
      if (!NEUTRAL_TAGS.has(tag)) out.add(tag);
    }
  }
  return [...out].sort();
}

export const isHealthyOwner = (user: OwnerFacts | null | undefined) =>
  !!user && user.role !== 'ADMIN' && user.isActive && !user.isPurged;

export function warningsFor(
  product: ProductFacts,
  platforms: Map<string, PlatformFacts>,
): string[] {
  const warnings: string[] = [];
  if (!product.createdByUserId) warnings.push('CREATED_BY_NULL');
  if (product.owner && !product.owner.hasDocument)
    warnings.push('OWNER_WITHOUT_CPF_CNPJ');
  if (product.tags.length > 1) warnings.push('MULTIPLE_TAGS');
  if (!product.tags.length) warnings.push('NO_TAG');
  for (const tag of product.tags) {
    const platform = platforms.get(tag);
    if (!platform) warnings.push(`TAG_UNREGISTERED:${tag}`);
    else if (!platform.isActive) warnings.push(`TAG_INACTIVE:${tag}`);
  }
  if (product.agreement?.some((p) => p.role === 'ADMIN'))
    warnings.push('COPRODUCTION_ADMIN_PARTICIPANT');
  return warnings;
}

/**
 * Pure classification. `candidates` may contain an explicit mapping target which is validated by
 * the same rules as a platform owner (healthy, non-admin) and is the only non-registry evidence.
 */
export function classifyProduct(
  product: ProductFacts,
  platforms: Map<string, PlatformFacts>,
  users: Map<string, OwnerFacts>,
  explicitTarget?: string,
): Classification {
  const owner = product.owner;
  const active = product.tags
    .map((tag) => platforms.get(tag))
    .filter((p): p is PlatformFacts => !!p && p.isActive);
  const contradicting = active.filter((p) => p.ownerUserId !== owner?.id);
  if (
    isHealthyOwner(owner) &&
    !contradicting.length &&
    (!explicitTarget || explicitTarget === owner?.id)
  )
    return { status: 'OK' };

  const reasons: string[] = [];
  if (!owner) reasons.push('OWNER_NOT_FOUND');
  else {
    if (owner.role === 'ADMIN') reasons.push('OWNER_IS_ADMIN');
    if (!owner.isActive) reasons.push('OWNER_INACTIVE');
    if (owner.isPurged) reasons.push('OWNER_PURGED');
  }
  if (contradicting.length)
    reasons.push(
      `OWNER_DIFFERS_FROM_PLATFORM_OWNER:${contradicting.map((p) => p.tag).join(',')}`,
    );

  let target: string | undefined;
  let evidence = '';
  if (explicitTarget) {
    target = explicitTarget;
    evidence = 'explicit mapping file';
    const known = users.get(explicitTarget);
    if (!isHealthyOwner(known)) reasons.push('MAPPING_TARGET_NOT_ELIGIBLE');
    if (
      active.length &&
      (active.length > 1 || active[0].ownerUserId !== explicitTarget)
    )
      reasons.push('MAPPING_TARGET_DIFFERS_FROM_PLATFORM_OWNER');
  } else {
    if (!product.tags.length) reasons.push('NO_PLATFORM_TAG');
    if (product.tags.length > 1) reasons.push('MULTIPLE_TAGS');
    for (const tag of product.tags) {
      const platform = platforms.get(tag);
      if (!platform) reasons.push(`TAG_UNREGISTERED:${tag}`);
      else if (!platform.isActive) reasons.push(`TAG_INACTIVE:${tag}`);
    }
    if (product.tags.length === 1 && active.length === 1) {
      target = active[0].ownerUserId;
      evidence = `Platform.ownerUserId of ${active[0].tag}`;
      if (!isHealthyOwner(users.get(target)))
        reasons.push(`PLATFORM_OWNER_NOT_ELIGIBLE:${active[0].tag}`);
    }
  }
  if (!target) reasons.push('NO_UNAMBIGUOUS_TARGET');

  if (target && target === owner?.id)
    reasons.push('TARGET_EQUALS_CURRENT_OWNER');
  for (const member of product.agreement ?? []) {
    if (member.role === 'ADMIN') reasons.push('COPRODUCTION_ADMIN_PARTICIPANT');
    if (member.id === owner?.id)
      reasons.push('COPRODUCTION_REFERENCES_CURRENT_OWNER');
    if (target && member.id === target)
      reasons.push('COPRODUCTION_REFERENCES_TARGET');
  }
  const unique = [...new Set(reasons)];
  const blocking = unique.filter(
    (r) =>
      !['OWNER_IS_ADMIN', 'OWNER_INACTIVE', 'OWNER_PURGED'].includes(r) &&
      !r.startsWith('OWNER_DIFFERS_FROM_PLATFORM_OWNER'),
  );
  if (!target || blocking.length)
    return { status: 'NEEDS_DECISION', reasons: unique };
  return { status: 'PROPOSE_TRANSFER', targetUserId: target, evidence };
}

export type MappingEntry = {
  productType: ProductType;
  productId: string;
  newOwnerUserId: string;
  reason: string;
  /** Optional guard: the owner the approver saw; a different current owner aborts the change. */
  expectedFromUserId?: string;
};

export function parseMapping(raw: unknown): MappingEntry[] {
  if (!Array.isArray(raw)) throw new Error('Mapping must be a JSON array');
  const seen = new Set<string>();
  return raw.map((row, index) => {
    const e = row as Partial<MappingEntry>;
    if (
      !e ||
      !PRODUCT_TYPES.includes(e.productType as ProductType) ||
      typeof e.productId !== 'string' ||
      !e.productId ||
      typeof e.newOwnerUserId !== 'string' ||
      !e.newOwnerUserId ||
      typeof e.reason !== 'string' ||
      e.reason.trim().length < 3 ||
      (e.expectedFromUserId !== undefined &&
        typeof e.expectedFromUserId !== 'string')
    )
      throw new Error(`Invalid mapping entry #${index + 1}`);
    const key = `${e.productType}:${e.productId}`;
    if (seen.has(key)) throw new Error(`Duplicate mapping entry ${key}`);
    seen.add(key);
    return {
      productType: e.productType!,
      productId: e.productId,
      newOwnerUserId: e.newOwnerUserId,
      reason: e.reason.trim(),
      ...(e.expectedFromUserId
        ? { expectedFromUserId: e.expectedFromUserId }
        : {}),
    };
  });
}

/** Deterministic hash of the approved mapping, independent of entry order and file formatting. */
export function mappingHash(entries: MappingEntry[]): string {
  const canonical = [...entries]
    .sort((a, b) =>
      `${a.productType}:${a.productId}`.localeCompare(
        `${b.productType}:${b.productId}`,
      ),
    )
    .map((e) => [
      e.productType,
      e.productId,
      e.newOwnerUserId,
      e.reason,
      e.expectedFromUserId ?? null,
    ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function hostOf(url: string): string {
  return new URL(url).hostname;
}
