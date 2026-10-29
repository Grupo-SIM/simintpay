import { Prisma } from '@prisma/client';

/**
 * Single source of truth for "which platform does a Transaction belong to".
 *
 * `Transaction.platformTag` is seeded from the `[TENANT:x]` description marker (migration backfill and
 * a BEFORE INSERT trigger), then it is the ONLY thing that governs platform ownership. Editing a
 * description never changes it; `null` means untagged by design. Never parse descriptions here.
 *
 * Normalization mirrors SQL `transaction_canonical_platform_tag`: trim, uppercase, `_` -> `-`,
 * EBOOKSIM -> EBOOK.
 */
export function canonicalTransactionPlatformTag(
  tag: string | null | undefined,
): string | null {
  const value = String(tag ?? '')
    .trim()
    .toUpperCase();
  if (!value) return null;
  if (value === 'EBOOKSIM') return 'EBOOK';
  return value.replaceAll('_', '-');
}

function canonicalList(tags: string | readonly string[]): string[] {
  const list = typeof tags === 'string' ? [tags] : tags;
  return [
    ...new Set(
      list
        .map(canonicalTransactionPlatformTag)
        .filter((tag): tag is string => tag !== null),
    ),
  ];
}

/** Prisma filter: transactions whose stored platformTag is one of `tags` (aliases are normalized). */
export function whereTransactionPlatform(
  tags: string | readonly string[],
): Prisma.TransactionWhereInput {
  const list = canonicalList(tags);
  return list.length === 1
    ? { platformTag: list[0] }
    : { platformTag: { in: list } };
}

/** Prisma filter: any tagged transaction (replaces `description contains '[TENANT:'`). */
export const whereTransactionHasPlatform: Prisma.TransactionWhereInput = {
  platformTag: { not: null },
};

/** Raw SQL fragment for `alias."platformTag" IN (...)`. `alias` is a trusted identifier, e.g. `t`. */
export function sqlTransactionPlatform(
  alias: string,
  tags: string | readonly string[],
): Prisma.Sql {
  const list = canonicalList(tags);
  const column = Prisma.raw(`"${alias.replaceAll('"', '')}"."platformTag"`);
  return list.length
    ? Prisma.sql`${column} IN (${Prisma.join(list)})`
    : Prisma.sql`false`;
}

/** In-memory platform of a row. No description fallback: null is untagged. */
export function transactionPlatformTag(tx: {
  platformTag?: string | null;
}): string | null {
  return canonicalTransactionPlatformTag(tx.platformTag);
}

/**
 * `platformTag` value to persist on create when the platform is known at insert time.
 * `GLOBAL` means "no platform" (descriptions never carry a GLOBAL marker), so it stays untagged.
 */
export function transactionPlatformTagData(tag: string | null | undefined): {
  platformTag?: string;
} {
  const canonical = canonicalTransactionPlatformTag(tag);
  return canonical && canonical !== 'GLOBAL' ? { platformTag: canonical } : {};
}
