import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type EbookIdentity = { externalUserId: string; document: string };
export type EbookItem = {
  itemId: string;
  productId: number;
  quantity: number;
  grossCents: number;
  fixedFeeCents: number;
  owner: EbookIdentity;
  affiliate:
    | (EbookIdentity & {
        linkId: number;
        linkCode: string;
        commissionRateBps: number;
      })
    | null;
  buyer: { externalUserId: string; document: string | null };
};
export type EbookManifest = {
  version: 1;
  manifestId: string;
  orderId: number;
  orderNumber: string;
  currency: 'BRL';
  grossCents: number;
  fixedFeeSnapshot: unknown;
  items: EbookItem[];
};
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}
export const ebookHash = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export function validDocument(document: string): boolean {
  if (!/^\d{11}$|^\d{14}$/.test(document) || /^(\d)\1+$/.test(document))
    return false;
  const digits = [...document].map(Number);
  const check = (base: number[], weights: number[]) => {
    const r = base.reduce((sum, digit, i) => sum + digit * weights[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (digits.length === 11)
    return (
      check(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === digits[9] &&
      check(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) ===
        digits[10]
    );
  return (
    check(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) ===
      digits[12] &&
    check(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) ===
      digits[13]
  );
}
export function validateEbookManifest(value: unknown): EbookManifest {
  const m = value as EbookManifest;
  const fail = () => {
    throw new BadRequestException('Manifesto Ebook inválido');
  };
  if (
    !m ||
    m.version !== 1 ||
    m.currency !== 'BRL' ||
    !/^[\w-]{16,100}$/.test(m.manifestId) ||
    !Number.isSafeInteger(m.orderId) ||
    !m.orderNumber ||
    !Number.isSafeInteger(m.grossCents) ||
    m.grossCents <= 0 ||
    !Array.isArray(m.items) ||
    !m.items.length ||
    m.items.length > 100
  )
    fail();
  const ids = new Set<string>();
  for (const item of m.items) {
    if (
      !item.itemId ||
      ids.has(item.itemId) ||
      !Number.isSafeInteger(item.productId) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      !Number.isSafeInteger(item.grossCents) ||
      item.grossCents <= 0 ||
      !Number.isSafeInteger(item.fixedFeeCents) ||
      item.fixedFeeCents < 0
    )
      fail();
    ids.add(item.itemId);
    for (const identity of [item.owner, item.affiliate].filter(
      Boolean,
    ) as EbookIdentity[])
      if (!identity.externalUserId || !validDocument(identity.document)) fail();
    if (
      item.affiliate &&
      (!Number.isSafeInteger(item.affiliate.commissionRateBps) ||
        item.affiliate.commissionRateBps < 0 ||
        item.affiliate.commissionRateBps > 10000 ||
        !item.affiliate.linkId ||
        !item.affiliate.linkCode)
    )
      fail();
  }
  if (m.items.reduce((sum, item) => sum + item.grossCents, 0) !== m.grossCents)
    fail();
  return JSON.parse(canonicalJson(m));
}
/** Largest remainder allocation; stable item IDs break equal remainders. */
export function allocateEbookCents(
  total: number,
  items: { itemId: string; grossCents: number }[],
): Map<string, number> {
  if (!Number.isSafeInteger(total) || total < 0)
    throw new BadRequestException('Taxa inválida');
  const gross = items.reduce((sum, item) => sum + BigInt(item.grossCents), 0n);
  const shares = items.map((item) => ({
    id: item.itemId,
    amount: Number((BigInt(total) * BigInt(item.grossCents)) / gross),
    remainder: (BigInt(total) * BigInt(item.grossCents)) % gross,
  }));
  let rest = total - shares.reduce((sum, share) => sum + share.amount, 0);
  shares.sort((a, b) =>
    a.remainder === b.remainder
      ? a.id.localeCompare(b.id)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const share of shares) if (rest-- > 0) share.amount++;
  return new Map(shares.map((share) => [share.id, share.amount]));
}
