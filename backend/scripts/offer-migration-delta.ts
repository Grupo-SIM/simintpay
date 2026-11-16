/**
 * Phase 4 of plan 0023: after the legacy writers were frozen (`OFFER_LEGACY_FREEZE=1`), copies what
 * changed in the legacy products since the Phase 2 copy to their `Offer` rows. Legacy rows are never
 * changed. Dry run by default; `--apply` writes. Divergences that are not a safe copy are reported with
 * a field-by-field diff and left alone.
 *
 *   # plan only (default, read-only transaction)
 *   bun --no-env-file scripts/offer-migration-delta.ts --database-url=postgresql://...
 *   # write
 *   bun --no-env-file scripts/offer-migration-delta.ts --database-url=... --apply --i-understand-this-writes
 *   # nothing may differ any more; exit code 1 on any divergence
 *   bun --no-env-file scripts/offer-migration-delta.ts --database-url=... --verify
 *
 * Extra flags: `--skip-active` (do not copy `isActive`, for legacy rows that were only deactivated as
 * the freeze), `--overwrite=<offerId>[,<offerId>...]` (explicit: copy every legacy value over those
 * Offers, except an amount below the minimum), `--allow-conflicts` (exit 0 despite unresolved diffs).
 *
 * What it does, in order: (1) creates the Offer (and ExternalRef, coproduction re-key) of legacy products
 * created after the copy, reusing offer-migration-apply; (2) copies the delta of the existing Offers:
 * `usedCount` (only upward), `isActive` and the other columns when only the legacy side changed since the
 * copy; (3) moves the coproduction agreements and revisions left under the old product keys to `ofertas`.
 *
 * The database must be given with `--database-url`; `DATABASE_URL` and `.env` are never read.
 * See docs/guides/offer-migration-runbook.md.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { type Offer, Prisma, PrismaClient } from '@prisma/client';
import type { OfferDraft } from '../src/modules/offer/legacy-offer-mapper';
import {
  applyPlan,
  buildPlan,
  canonical,
  type CliOptions,
  coproductionConflict,
  describeTarget,
  KIND_ORDER,
  LEGACY_COPRODUCTION_PRODUCT,
  loadCandidates,
  MIN_AMOUNT_CENTS,
  OFFER_COPRODUCTION_PRODUCT,
  type Plan,
  parseArgs,
  renameCoproduction,
  verify,
} from './offer-migration-apply';

type Reader = Prisma.TransactionClient | PrismaClient;
type LegacyKind = (typeof KIND_ORDER)[number];

export type DeltaOptions = CliOptions & {
  skipActive: boolean;
  overwrite: Set<string>;
  allowConflicts: boolean;
};

export function parseDeltaArgs(argv: string[]): DeltaOptions {
  const base = parseArgs(argv);
  const overwrite = new Set<string>();
  for (const arg of argv)
    if (arg.startsWith('--overwrite='))
      for (const id of arg.slice('--overwrite='.length).split(','))
        if (id.trim()) overwrite.add(id.trim());
  if (argv.includes('--overwrite'))
    throw new Error(
      '--overwrite needs explicit ids: --overwrite=<offerId,...>',
    );
  return {
    ...base,
    skipActive: argv.includes('--skip-active'),
    overwrite,
    allowConflicts: argv.includes('--allow-conflicts'),
  };
}

/** Offer columns that follow the legacy row, in the order they are reported. */
export const DELTA_FIELDS = [
  'name',
  'description',
  'platformTag',
  'code',
  'ownerUserId',
  'amountCents',
  'acceptedMethods',
  'maxInstallments',
  'expiresAt',
  'maxUses',
  'usedCount',
  'isActive',
  'renewalMode',
  'intervalType',
  'intervalCount',
  'repetitions',
  'retryDays',
  'fulfillment',
  'metadata',
] as const;
export type DeltaField = (typeof DELTA_FIELDS)[number];

/** Columns offer-migration-apply `--verify` already compares (not repeated by our verify). */
export const COVERED_BY_BASE_VERIFY: DeltaField[] = [
  'amountCents',
  'code',
  'ownerUserId',
  'fulfillment',
  'metadata',
];

/** Keys inside the JSON columns that come from the legacy row; the Offer may own others (files, bumps). */
const FULFILLMENT_KEYS = ['redirectUrl', 'emailBody'] as const;
const METADATA_KEYS = ['boletoDueDays', 'requiresBuyerAddress'] as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const pick = (value: unknown, keys: readonly string[]) => {
  const source = asRecord(value);
  const picked = Object.fromEntries(
    keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
  );
  return Object.keys(picked).length ? picked : null;
};

/** Comparable value of a column: what the legacy row owns, normalised. */
function comparable(field: DeltaField, value: unknown): unknown {
  switch (field) {
    case 'expiresAt':
      return value instanceof Date ? value.getTime() : null;
    case 'acceptedMethods':
      return [...((value as string[] | null) ?? [])].sort();
    case 'fulfillment':
      return pick(value, FULFILLMENT_KEYS);
    case 'metadata':
      return pick(value, METADATA_KEYS);
    default:
      return value ?? null;
  }
}

export type OfferRow = Pick<
  Offer,
  DeltaField | 'id' | 'createdAt' | 'updatedAt'
>;
export type FieldDiff = { field: DeltaField; offer: unknown; legacy: unknown };

/** Fields where the Offer differs from what the legacy row would be copied as. Pure. */
export function diffOffer(draft: OfferDraft, offer: OfferRow): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of DELTA_FIELDS) {
    const legacy = (draft as unknown as Record<string, unknown>)[field];
    const offerValue = (offer as unknown as Record<string, unknown>)[field];
    if (
      canonical(comparable(field, offerValue)) !==
      canonical(comparable(field, legacy))
    )
      diffs.push({
        field,
        offer: comparable(field, offerValue),
        legacy: comparable(field, legacy),
      });
  }
  return diffs;
}

export type Resolution = 'AUTO' | 'CONFLICT';
export type ClassifiedDiff = FieldDiff & {
  resolution: Resolution;
  reason?: string;
};
export type ClassifyContext = {
  legacyUpdatedAt: Date;
  offerCreatedAt: Date;
  offerUpdatedAt: Date;
  overwrite: boolean;
  skipActive: boolean;
};

/** An Offer written only by the copy has `updatedAt` within this of its `createdAt`. */
export const OFFER_UNTOUCHED_TOLERANCE_MS = 2_000;

/**
 * Decides, per differing column, whether copying the legacy value is safe. Never decreases `usedCount`,
 * never writes an amount below the minimum, never touches `code` (public URL), and writes the other
 * columns only when the legacy row changed since the copy and the Offer did not. Pure.
 */
export function classifyDiffs(
  diffs: FieldDiff[],
  ctx: ClassifyContext,
): ClassifiedDiff[] {
  const legacyChanged = ctx.legacyUpdatedAt > ctx.offerCreatedAt;
  const offerUntouched =
    ctx.offerUpdatedAt.getTime() - ctx.offerCreatedAt.getTime() <=
    OFFER_UNTOUCHED_TOLERANCE_MS;
  const general = (): { resolution: Resolution; reason?: string } => {
    if (ctx.overwrite) return { resolution: 'AUTO' };
    if (legacyChanged && offerUntouched) return { resolution: 'AUTO' };
    return {
      resolution: 'CONFLICT',
      reason: legacyChanged
        ? 'BOTH_CHANGED: legacy and Offer were both edited since the copy'
        : 'OFFER_EDITED: Offer differs but the legacy row did not change since the copy',
    };
  };
  const out: ClassifiedDiff[] = [];
  for (const diff of diffs) {
    if (diff.field === 'isActive' && ctx.skipActive) continue;
    let verdict: { resolution: Resolution; reason?: string };
    if (diff.field === 'usedCount') {
      const legacy = Number(diff.legacy);
      const offer = Number(diff.offer);
      verdict =
        legacy > offer || ctx.overwrite
          ? { resolution: 'AUTO' }
          : {
              resolution: 'CONFLICT',
              reason: `OFFER_AHEAD: Offer counted ${offer} uses, legacy ${legacy}; never decreased`,
            };
    } else if (diff.field === 'isActive') {
      verdict = { resolution: 'AUTO' };
    } else if (diff.field === 'amountCents') {
      const legacy = diff.legacy as number | null;
      if (legacy === null)
        verdict = {
          resolution: 'CONFLICT',
          reason: 'INVALID_AMOUNT: legacy amount is not an exact cent value',
        };
      else if (legacy < MIN_AMOUNT_CENTS)
        verdict = {
          resolution: 'CONFLICT',
          reason: `BELOW_MINIMUM: legacy ${legacy} cents is under the ${MIN_AMOUNT_CENTS} cents minimum; fix the legacy amount or keep the Offer`,
        };
      else verdict = general();
    } else if (diff.field === 'code') {
      verdict =
        ctx.overwrite && diff.legacy
          ? { resolution: 'AUTO' }
          : {
              resolution: 'CONFLICT',
              reason:
                'CODE_CHANGED: the code is the public URL; decide which one stays',
            };
    } else if (
      (diff.field === 'ownerUserId' || diff.field === 'name') &&
      (diff.legacy === null || diff.legacy === undefined)
    ) {
      verdict = {
        resolution: 'CONFLICT',
        reason: `MISSING_${diff.field === 'name' ? 'NAME' : 'OWNER'}: legacy row has no value`,
      };
    } else verdict = general();
    out.push({ ...diff, ...verdict });
  }
  return out;
}

/** Prisma update for the AUTO diffs only; JSON columns keep the keys the legacy row does not own. */
export function buildUpdate(
  draft: OfferDraft,
  offer: OfferRow,
  diffs: ClassifiedDiff[],
): Prisma.OfferUncheckedUpdateManyInput {
  const data: Record<string, unknown> = {};
  const merge = (
    current: unknown,
    owned: readonly string[],
    legacy: unknown,
  ) => {
    const next = { ...asRecord(current) };
    for (const key of owned) delete next[key];
    Object.assign(next, asRecord(legacy));
    return Object.keys(next).length
      ? (next as Prisma.InputJsonValue)
      : Prisma.DbNull;
  };
  for (const diff of diffs) {
    if (diff.resolution !== 'AUTO') continue;
    if (diff.field === 'fulfillment')
      data.fulfillment = merge(
        offer.fulfillment,
        FULFILLMENT_KEYS,
        draft.fulfillment,
      );
    else if (diff.field === 'metadata')
      data.metadata = merge(offer.metadata, METADATA_KEYS, draft.metadata);
    else
      data[diff.field] = (draft as unknown as Record<string, unknown>)[
        diff.field
      ];
  }
  return data as Prisma.OfferUncheckedUpdateManyInput;
}

export type ProductDelta = {
  legacyType: LegacyKind;
  legacyId: string;
  diffs: ClassifiedDiff[];
  draft: OfferDraft;
  offer: OfferRow;
};
export type CoproductionLeftover = {
  product: string;
  productId: string;
  legacyType: LegacyKind;
  agreements: number;
  revisions: number;
  offerExists: boolean;
  conflict?: string;
};
export type DeltaPlan = {
  /** apply's plan: Offers missing for legacy rows created after the copy are its CREATE decisions. */
  plan: Plan;
  products: ProductDelta[];
  coproduction: CoproductionLeftover[];
};

const typeByCoproductionKey = new Map(
  Object.entries(LEGACY_COPRODUCTION_PRODUCT).map(([type, product]) => [
    product,
    type as LegacyKind,
  ]),
);

async function legacyUpdatedAt(db: Reader): Promise<Map<string, Date>> {
  const select = { id: true, updatedAt: true } as const;
  // Sequential on purpose: a transaction client holds a single connection.
  const rows: [LegacyKind, { id: string; updatedAt: Date }[]][] = [
    ['PaymentLink', await db.paymentLink.findMany({ select })],
    ['SubscriptionLink', await db.subscriptionLink.findMany({ select })],
    ['Plan', await db.plan.findMany({ select })],
    ['PixCreditPlan', await db.pixCreditPlan.findMany({ select })],
    ['Boleto', await db.boleto.findMany({ select })],
  ];
  return new Map(
    rows.flatMap(([type, list]) =>
      list.map((r) => [`${type}:${r.id}`, r.updatedAt] as const),
    ),
  );
}

/** Agreements and revisions still keyed by an old product table name. Read-only. */
export async function findCoproductionLeftovers(
  db: Reader,
): Promise<CoproductionLeftover[]> {
  const products = [...typeByCoproductionKey.keys()];
  const agreements = await db.coproductionAgreement.findMany({
    where: { product: { in: products } },
  });
  const revisions = await db.coproductionRevision.findMany({
    where: { product: { in: products } },
  });
  const keys = new Map<string, { product: string; productId: string }>();
  for (const r of [...agreements, ...revisions])
    keys.set(`${r.product}:${r.productId}`, {
      product: r.product,
      productId: r.productId,
    });
  const offers = await db.offer.findMany({
    where: { id: { in: [...keys.values()].map((k) => k.productId) } },
    select: { id: true },
  });
  const offerIds = new Set(offers.map((o) => o.id));
  const result: CoproductionLeftover[] = [];
  for (const { product, productId } of keys.values()) {
    const legacy = {
      agreement: agreements.find(
        (a) => a.product === product && a.productId === productId,
      ),
      revisions: revisions.filter(
        (r) => r.product === product && r.productId === productId,
      ),
    };
    const target = {
      agreement:
        (await db.coproductionAgreement.findUnique({
          where: {
            product_productId: {
              product: OFFER_COPRODUCTION_PRODUCT,
              productId,
            },
          },
        })) ?? undefined,
      revisions: await db.coproductionRevision.findMany({
        where: { product: OFFER_COPRODUCTION_PRODUCT, productId },
      }),
    };
    result.push({
      product,
      productId,
      legacyType: typeByCoproductionKey.get(product)!,
      agreements: legacy.agreement ? 1 : 0,
      revisions: legacy.revisions.length,
      offerExists: offerIds.has(productId),
      conflict: coproductionConflict(legacy, target),
    });
  }
  return result.sort((a, b) =>
    `${a.product}:${a.productId}`.localeCompare(`${b.product}:${b.productId}`),
  );
}

export async function buildDeltaPlan(
  db: Reader,
  options: Pick<DeltaOptions, 'skipActive' | 'overwrite'>,
): Promise<DeltaPlan> {
  const plan = await buildPlan(db);
  const { candidates } = await loadCandidates(db);
  const updated = await legacyUpdatedAt(db);
  const offers = await db.offer.findMany({
    where: { id: { in: candidates.map((c) => c.draft.legacyId) } },
  });
  const byId = new Map(offers.map((o) => [o.id, o]));
  const products: ProductDelta[] = [];
  for (const { draft } of candidates) {
    const offer = byId.get(draft.legacyId);
    const legacyAt = updated.get(`${draft.legacyType}:${draft.legacyId}`);
    if (!offer || !legacyAt) continue;
    const diffs = classifyDiffs(diffOffer(draft, offer), {
      legacyUpdatedAt: legacyAt,
      offerCreatedAt: offer.createdAt,
      offerUpdatedAt: offer.updatedAt,
      overwrite: options.overwrite.has(offer.id),
      skipActive: options.skipActive,
    });
    products.push({
      legacyType: draft.legacyType as LegacyKind,
      legacyId: draft.legacyId,
      diffs,
      draft,
      offer,
    });
  }
  return {
    plan,
    products,
    coproduction: await findCoproductionLeftovers(db),
  };
}

const fmt = (value: unknown) =>
  value === undefined ? 'undefined' : JSON.stringify(value);

export const countCreates = (dp: DeltaPlan) =>
  dp.plan.decisions.filter((d) => d.status === 'CREATE').length;
export const autoDiffs = (dp: DeltaPlan) =>
  dp.products.flatMap((p) => p.diffs.filter((d) => d.resolution === 'AUTO'));
export const conflictLines = (dp: DeltaPlan): string[] => [
  ...dp.products.flatMap((p) =>
    p.diffs
      .filter((d) => d.resolution === 'CONFLICT')
      .map(
        (d) =>
          `${p.legacyType}:${p.legacyId} ${d.field}: Offer ${fmt(d.offer)} != legacy ${fmt(d.legacy)} [${d.reason}]`,
      ),
  ),
  ...dp.coproduction
    .filter((c) => !c.offerExists || c.conflict)
    .map(
      (c) =>
        `coproduction ${c.product}:${c.productId}: ${
          c.offerExists
            ? `COPRODUCTION_CONFLICT ${c.conflict}`
            : 'ORPHAN: no Offer with this id to receive it'
        }`,
    ),
];

export function printDeltaPlan(
  dp: DeltaPlan,
  log: (line: string) => void = console.log,
) {
  const creates = dp.plan.decisions.filter((d) => d.status === 'CREATE');
  log(
    `Legacy products without an Offer yet: ${creates.length} (created after the copy; apply copies them)`,
  );
  for (const d of creates)
    log(
      `  CREATE ${d.candidate.draft.legacyType}:${d.candidate.draft.legacyId} code=${d.candidate.draft.code ?? '-'}`,
    );
  const refused = dp.plan.decisions.filter(
    (d) => d.status !== 'CREATE' && d.status !== 'SKIP_EXISTING',
  );
  for (const d of refused)
    log(
      `  ${d.status} ${d.candidate.draft.legacyType}:${d.candidate.draft.legacyId} [${d.reasons.join('; ')}]`,
    );
  const changed = dp.products.filter((p) => p.diffs.length);
  log(
    `\nExisting Offers: ${dp.products.length} (${dp.products.length - changed.length} in sync, ${changed.length} with a delta)`,
  );
  for (const p of changed) {
    log(`  ${p.legacyType}:${p.legacyId}`);
    for (const d of p.diffs)
      log(
        `    ${d.resolution === 'AUTO' ? 'COPY    ' : 'CONFLICT'} ${d.field}: Offer ${fmt(d.offer)} -> legacy ${fmt(d.legacy)}${d.reason ? ` [${d.reason}]` : ''}`,
      );
  }
  if (autoDiffs(dp).some((d) => d.field === 'isActive'))
    log(
      '\nNOTE: isActive differs. If the legacy links were deactivated only as the freeze, rerun with --skip-active so the Offers stay active.',
    );
  log(`\nCoproduction left under old product keys: ${dp.coproduction.length}`);
  for (const c of dp.coproduction)
    log(
      `  ${c.product}:${c.productId} (${c.agreements} agreement, ${c.revisions} revision(s)) ${
        !c.offerExists
          ? 'ORPHAN (no Offer)'
          : c.conflict
            ? `CONFLICT ${c.conflict}`
            : `-> ${OFFER_COPRODUCTION_PRODUCT}`
      }`,
    );
  log(
    `\nSummary: ${creates.length} to create, ${autoDiffs(dp).length} field(s) to copy, ${conflictLines(dp).length} unresolved divergence(s).`,
  );
}

export type DeltaResult = {
  created: number;
  updatedOffers: number;
  stale: string[];
  coproductionMoved: number;
  unresolved: string[];
};

/** Writes the delta. Order: missing Offers, field delta, leftover coproduction. */
export async function applyDelta(
  prisma: PrismaClient,
  dp: DeltaPlan,
  log: (line: string) => void = () => {},
): Promise<DeltaResult> {
  const result: DeltaResult = {
    created: 0,
    updatedOffers: 0,
    stale: [],
    coproductionMoved: 0,
    unresolved: [],
  };
  const creatable = {
    ...dp.plan,
    decisions: dp.plan.decisions.filter(
      (d) => d.status === 'CREATE' || d.status === 'SKIP_EXISTING',
    ),
  };
  result.created = (await applyPlan(prisma, creatable, log)).created;

  for (const p of dp.products) {
    const data = buildUpdate(p.draft, p.offer, p.diffs);
    if (!Object.keys(data).length) continue;
    // Guarded by the `updatedAt` seen in the plan: an Offer edited meanwhile is left alone.
    const { count } = await prisma.offer.updateMany({
      where: { id: p.offer.id, updatedAt: p.offer.updatedAt },
      data,
    });
    if (count) {
      result.updatedOffers++;
      log(
        `  updated ${p.legacyType}:${p.legacyId}: ${Object.keys(data).join(', ')}`,
      );
    } else result.stale.push(`${p.legacyType}:${p.legacyId}`);
  }

  for (const c of await findCoproductionLeftovers(prisma)) {
    if (!c.offerExists || c.conflict) continue;
    const moved = await prisma.$transaction(
      (tx) => renameCoproduction(tx, c.legacyType, c.productId),
      { timeout: 120_000, maxWait: 15_000 },
    );
    result.coproductionMoved += moved.agreements + moved.revisions;
    log(
      `  coproduction ${c.product}:${c.productId} -> ${OFFER_COPRODUCTION_PRODUCT} (${moved.agreements} agreement, ${moved.revisions} revision(s))`,
    );
  }

  const after = await buildDeltaPlan(prisma, {
    skipActive: false,
    overwrite: new Set(),
  });
  result.unresolved = conflictLines(after);
  return result;
}

/**
 * Everything that must be equal once the delta was copied: apply's `--verify` plus the columns it does
 * not compare (usage counter, active flag, name, installments, intervals...) and coproduction left under
 * an old key without an Offer.
 */
export async function verifyDelta(
  db: Reader,
  options: Pick<DeltaOptions, 'skipActive'>,
): Promise<string[]> {
  const problems = await verify(db);
  const dp = await buildDeltaPlan(db, {
    skipActive: options.skipActive,
    overwrite: new Set(),
  });
  for (const p of dp.products)
    for (const d of p.diffs) {
      if (COVERED_BY_BASE_VERIFY.includes(d.field)) continue;
      problems.push(
        `${p.legacyType}:${p.legacyId}: ${d.field} Offer ${fmt(d.offer)} != legacy ${fmt(d.legacy)}`,
      );
    }
  for (const c of dp.coproduction)
    if (!c.offerExists)
      problems.push(
        `coproduction ${c.product}:${c.productId}: agreement under an old key and no Offer with this id`,
      );
  return problems;
}

async function main() {
  const options = parseDeltaArgs(process.argv.slice(2));
  console.log(`Target database: ${describeTarget(options.databaseUrl)}`);
  console.log(
    `Mode: ${options.verify ? 'VERIFY' : options.apply ? 'APPLY (writes)' : 'DRY RUN'}`,
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: options.databaseUrl, max: 2 }),
  });
  const readOnly = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return work(tx);
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  try {
    if (options.verify) {
      const problems = await readOnly((tx) => verifyDelta(tx, options));
      if (problems.length) {
        console.error(`VERIFY FAILED: ${problems.length} divergence(s)`);
        for (const p of problems) console.error(`  ${p}`);
        process.exitCode = 1;
      } else console.log('VERIFY OK: legacy rows and Offers match.');
      return;
    }
    const dp = await readOnly((tx) => buildDeltaPlan(tx, options));
    printDeltaPlan(dp);
    if (!options.apply) {
      console.log('\nDry run: nothing was written.');
      if (conflictLines(dp).length && !options.allowConflicts)
        process.exitCode = 1;
      return;
    }
    console.log('\nApplying...');
    const result = await applyDelta(prisma, dp, console.log);
    console.log(
      `Done: ${result.created} offer(s) created, ${result.updatedOffers} offer(s) updated, ${result.coproductionMoved} coproduction row(s) moved.`,
    );
    if (result.stale.length)
      console.error(
        `Changed meanwhile, skipped (run again): ${result.stale.join(', ')}`,
      );
    if (result.unresolved.length) {
      console.error(
        `${result.unresolved.length} divergence(s) were NOT copied and need a decision:`,
      );
      for (const line of result.unresolved) console.error(`  ${line}`);
      if (!options.allowConflicts) process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.stack || error.message : error,
    );
    process.exit(1);
  });
