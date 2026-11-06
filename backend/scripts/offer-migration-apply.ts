/**
 * Additive migration of the five legacy products into shadow `Offer` rows (plan 0021, phase 4).
 * Legacy rows are never changed or deleted; they remain the live source.
 *
 *   # plan only (default, read-only transaction)
 *   bun --no-env-file scripts/offer-migration-apply.ts --database-url=postgresql://...
 *   # write
 *   bun --no-env-file scripts/offer-migration-apply.ts --database-url=... --apply --i-understand-this-writes
 *   # compare legacy rows with Offers; exit code 1 on any mismatch
 *   bun --no-env-file scripts/offer-migration-apply.ts --database-url=... --verify
 *
 * The database must be given with `--database-url`; `DATABASE_URL` and `.env` are never read.
 * See docs/guides/offer-migration-runbook.md.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  type LegacyType,
  mapBoleto,
  mapPaymentLink,
  mapPixCreditPlan,
  mapPlan,
  mapSubscriptionLink,
  type OfferDraft,
} from '../src/modules/offer/legacy-offer-mapper';

export const MIN_AMOUNT_CENTS = 1499;
export const ACQUIRER_CODE = 'DOM';
export const KIND_ORDER: LegacyType[] = [
  'PaymentLink',
  'SubscriptionLink',
  'Plan',
  'PixCreditPlan',
  'Boleto',
];

export type CliOptions = {
  databaseUrl: string;
  apply: boolean;
  verify: boolean;
  /** Do not fail (exit code) when some product is BLOCKED. */
  allowBlocked: boolean;
};

export function parseArgs(argv: string[]): CliOptions {
  let databaseUrl: string | undefined;
  argv.forEach((arg, i) => {
    if (arg.startsWith('--database-url='))
      databaseUrl = arg.slice('--database-url='.length);
    else if (arg === '--database-url') databaseUrl = argv[i + 1];
  });
  databaseUrl = databaseUrl?.trim();
  if (!databaseUrl || databaseUrl.startsWith('--'))
    throw new Error(
      'Refusing to run: pass --database-url=<url>. DATABASE_URL and .env are never used.',
    );
  const apply = argv.includes('--apply');
  const verify = argv.includes('--verify');
  if (apply && verify)
    throw new Error('--apply and --verify are mutually exclusive.');
  if (apply && !argv.includes('--i-understand-this-writes'))
    throw new Error(
      'Refusing to write: --apply also requires --i-understand-this-writes.',
    );
  return {
    databaseUrl,
    apply,
    verify,
    allowBlocked: argv.includes('--allow-blocked'),
  };
}

export function describeTarget(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

type ExternalRefSpec = { kind: 'PAYMENT_LINK' | 'PLAN'; externalId: string };
export type Candidate = {
  draft: OfferDraft;
  ref?: ExternalRefSpec;
  ownerRole?: string;
};
export const BLOCKER_CODES = [
  'BLOCKED_HAS_FUNNEL_OFFERS',
  'BLOCKED_HAS_FILES',
  'BLOCKED_HAS_VOUCHERS',
  'BLOCKED_HAS_COMMUNITY',
  'BLOCKED_HAS_PIX_ACCESS',
  'BLOCKED_LIVE_DOM_SUBSCRIPTION',
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];
export type Preflight = {
  /** Why the product must not be migrated (it would lose data or behaviour). */
  blockers: { code: BlockerCode; detail: string }[];
  /** Non-blocking observations, printed. */
  notes: string[];
};
export type PreflightMap = Map<string, Preflight>;

export type Status =
  'CREATE' | 'SKIP_EXISTING' | 'REFUSED' | 'BLOCKED_ADMIN_OWNER' | 'BLOCKED';
export type Decision = {
  candidate: Candidate;
  status: Status;
  reasons: string[];
  warnings: string[];
};

const key = (type: string, id: string) => `${type}:${id}`;

type Reader = Prisma.TransactionClient | PrismaClient;

/** Order/subscription statuses that no longer charge anyone. Anything else counts as live. */
export const TERMINAL_SUBSCRIPTION_STATUSES = [
  'cancelled',
  'canceled',
  'inactive',
  'expired',
  'failed',
  'deactivated',
  'disabled',
];

/** Platform defaults of the per-link fee columns (schema.prisma, PaymentLink / SubscriptionLink). */
const PAYMENT_LINK_FEE_DEFAULTS: Record<string, number | boolean> = {
  platformFee1x: 9.0,
  platformFee2x: 13.3,
  platformFee3x: 14.68,
  platformFee4x: 16.04,
  platformFee5x: 17.37,
  platformFee6x: 18.67,
  platformFee7x: 19.95,
  platformFee8x: 21.21,
  platformFee9x: 22.44,
  platformFee10x: 23.64,
  platformFee11x: 24.83,
  platformFee12x: 25.99,
  cashbackFee: 3.0,
  debitFeePercent: 2.0,
  debitFeeFixed: 2.0,
  isStandalone: true,
};
const SUBSCRIPTION_LINK_FEE_DEFAULTS: Record<string, number | boolean> = {
  platformFee: 9.0,
  isStandalone: true,
};

/** Names of the fee columns whose value differs from the platform default. */
export function feeOverrides(
  row: Record<string, unknown>,
  defaults: Record<string, number | boolean>,
): string[] {
  return Object.entries(defaults)
    .filter(([column, value]) => {
      const actual = row[column];
      if (typeof value === 'boolean') return actual !== value;
      return Math.abs(Number(actual) - value) > 1e-9;
    })
    .map(([column]) => column);
}

const lc = (v: string) => v.trim().toLowerCase();

/**
 * Shared by the report and the apply: finds legacy products that still carry data or behaviour an
 * Offer cannot represent yet. Read-only. Counts only; no customer data is returned or printed.
 */
export async function findPreflight(
  db: Reader,
  drafts: OfferDraft[],
): Promise<PreflightMap> {
  const result: PreflightMap = new Map();
  const of = (d: OfferDraft): Preflight => {
    const k = key(d.legacyType, d.legacyId);
    let entry = result.get(k);
    if (!entry) result.set(k, (entry = { blockers: [], notes: [] }));
    return entry;
  };
  const block = (d: OfferDraft, code: BlockerCode, detail: string) =>
    of(d).blockers.push({ code, detail });
  const ofType = (type: LegacyType) =>
    drafts.filter((d) => d.legacyType === type);
  const ids = (type: LegacyType) => ofType(type).map((d) => d.legacyId);

  const paymentLinkIds = ids('PaymentLink');
  const subscriptionLinkIds = ids('SubscriptionLink');
  const planIds = ids('Plan');
  const pixPlanIds = ids('PixCreditPlan');

  // Sequential on purpose: a transaction client holds a single connection.
  const funnel = await db.paymentLinkOffer.groupBy({
    by: ['paymentLinkId'],
    where: { paymentLinkId: { in: paymentLinkIds }, deletedAt: null },
    _count: { _all: true },
  });
  const files = await db.paymentLinkFile.groupBy({
    by: ['paymentLinkId'],
    where: { paymentLinkId: { in: paymentLinkIds } },
    _count: { _all: true },
  });
  const bindings = await db.communityLinkBinding.findMany({
    where: {
      OR: [
        { paymentLinkId: { in: paymentLinkIds } },
        { subscriptionLinkId: { in: subscriptionLinkIds } },
      ],
    },
    select: { paymentLinkId: true, subscriptionLinkId: true },
  });
  const subOrders = await db.subscriptionLinkOrder.groupBy({
    by: ['subscriptionLinkId'],
    where: {
      subscriptionLinkId: { in: subscriptionLinkIds },
      domSubscriptionId: { not: null },
      status: { notIn: TERMINAL_SUBSCRIPTION_STATUSES },
    },
    _count: { _all: true },
  });
  const subscriptions = await db.subscription.groupBy({
    by: ['planId'],
    where: {
      planId: { in: planIds },
      domSubscriptionId: { not: null },
      status: { notIn: TERMINAL_SUBSCRIPTION_STATUSES },
    },
    _count: { _all: true },
  });
  const pixOrders = await db.pixPlanOrder.groupBy({
    by: ['pixCreditPlanId'],
    where: { pixCreditPlanId: { in: pixPlanIds } },
    _count: { _all: true },
  });
  const pixAccesses = await db.customerPlanAccess.groupBy({
    by: ['pixPlanId'],
    where: { pixPlanId: { in: pixPlanIds } },
    _count: { _all: true },
  });
  const vouchers = await db.voucher.findMany({
    select: { allowedLinkCodes: true, applicablePlans: true },
  });
  const voucherCodes = new Set(
    vouchers.flatMap((v) => v.allowedLinkCodes.map(lc)),
  );
  const voucherPlans = new Set(vouchers.flatMap((v) => v.applicablePlans));

  const pixCodeRows = await db.pixPlanLinkCode.findMany({
    where: { pixCreditPlanId: { in: pixPlanIds } },
    select: { code: true, pixCreditPlanId: true },
  });
  const pixCodes = new Map<string, string[]>();
  for (const r of pixCodeRows)
    pixCodes.set(r.pixCreditPlanId, [
      ...(pixCodes.get(r.pixCreditPlanId) ?? []),
      r.code,
    ]);

  const count = <T extends { _count: { _all: number } }>(
    rows: T[],
    field: keyof T,
  ) => new Map(rows.map((r) => [String(r[field]), r._count._all]));
  const funnelBy = count(funnel, 'paymentLinkId');
  const filesBy = count(files, 'paymentLinkId');
  const subOrdersBy = count(subOrders, 'subscriptionLinkId');
  const subscriptionsBy = count(subscriptions, 'planId');
  const pixOrdersBy = count(pixOrders, 'pixCreditPlanId');
  const pixAccessesBy = count(pixAccesses, 'pixPlanId');
  const boundLinks = new Set(
    bindings.flatMap((b) => [b.paymentLinkId, b.subscriptionLinkId]),
  );

  for (const d of drafts) {
    const id = d.legacyId;
    const n = (m: Map<string, number>) => m.get(id) ?? 0;
    if (n(funnelBy))
      block(
        d,
        'BLOCKED_HAS_FUNNEL_OFFERS',
        `${n(funnelBy)} order bump/upsell/downsell row(s)`,
      );
    if (n(filesBy))
      block(d, 'BLOCKED_HAS_FILES', `${n(filesBy)} delivery file(s)`);
    if (boundLinks.has(id))
      block(d, 'BLOCKED_HAS_COMMUNITY', 'bound to a community');
    if (n(subOrdersBy) || n(subscriptionsBy))
      block(
        d,
        'BLOCKED_LIVE_DOM_SUBSCRIPTION',
        `${n(subOrdersBy) + n(subscriptionsBy)} live DOM subscription(s) still charging`,
      );
    if (n(pixOrdersBy) || n(pixAccessesBy))
      block(
        d,
        'BLOCKED_HAS_PIX_ACCESS',
        `${n(pixOrdersBy)} order(s), ${n(pixAccessesBy)} access row(s)`,
      );
    const codes = [d.code, ...(pixCodes.get(id) ?? [])];
    if (
      codes.some((c) => c && voucherCodes.has(lc(c))) ||
      voucherCodes.has(lc(id)) ||
      voucherPlans.has(id)
    )
      block(d, 'BLOCKED_HAS_VOUCHERS', 'a voucher is bound to this product');
  }

  const paymentLinks = await db.paymentLink.findMany({
    where: { id: { in: paymentLinkIds } },
  });
  const subscriptionLinks = await db.subscriptionLink.findMany({
    where: { id: { in: subscriptionLinkIds } },
  });
  const noteFees = (
    type: LegacyType,
    rows: Record<string, unknown>[],
    defaults: Record<string, number | boolean>,
  ) => {
    const byId = new Map(
      drafts.filter((d) => d.legacyType === type).map((d) => [d.legacyId, d]),
    );
    for (const row of rows) {
      const fields = feeOverrides(row, defaults);
      const d = byId.get(String(row.id));
      if (d && fields.length)
        of(d).notes.push(
          `FEE_OVERRIDE_NOT_CARRIED: ${fields.join(', ')} (Offers use the financial-policy quote)`,
        );
    }
  };
  noteFees('PaymentLink', paymentLinks, PAYMENT_LINK_FEE_DEFAULTS);
  noteFees(
    'SubscriptionLink',
    subscriptionLinks,
    SUBSCRIPTION_LINK_FEE_DEFAULTS,
  );
  return result;
}

/** Number of products BLOCKED by the preflight (admin-owner blocks are counted apart). */
export const countBlocked = (plan: Plan) =>
  plan.decisions.filter((d) => d.status === 'BLOCKED').length;

export async function loadCandidates(db: Reader) {
  // Sequential on purpose: a transaction client holds a single connection.
  const paymentLinks = await db.paymentLink.findMany({
    orderBy: { id: 'asc' },
  });
  const subscriptionLinks = await db.subscriptionLink.findMany({
    orderBy: { id: 'asc' },
  });
  const plans = await db.plan.findMany({ orderBy: { id: 'asc' } });
  const pixPlans = await db.pixCreditPlan.findMany({
    orderBy: { id: 'asc' },
    include: { linkCodes: true },
  });
  const boletos = await db.boleto.findMany({ orderBy: { id: 'asc' } });
  const users = await db.user.findMany({ select: { id: true, role: true } });
  const roles = new Map(users.map((u) => [u.id, String(u.role)]));
  const withOwner = (c: Candidate): Candidate => ({
    ...c,
    ownerRole: c.draft.ownerUserId ? roles.get(c.draft.ownerUserId) : undefined,
  });
  const candidates: Candidate[] = [
    ...paymentLinks.map((r) => ({
      draft: mapPaymentLink(r),
      ref: r.domPaymentLinkId
        ? { kind: 'PAYMENT_LINK' as const, externalId: r.domPaymentLinkId }
        : undefined,
    })),
    ...subscriptionLinks.map((r) => ({
      draft: mapSubscriptionLink(r),
      ref: r.domPlanId
        ? { kind: 'PLAN' as const, externalId: r.domPlanId }
        : undefined,
    })),
    ...plans.map((r) => ({
      draft: mapPlan(r),
      ref: r.domPlanId
        ? { kind: 'PLAN' as const, externalId: r.domPlanId }
        : undefined,
    })),
    ...pixPlans.map((r) => ({ draft: mapPixCreditPlan(r) })),
    ...boletos.map((r) => ({
      draft: mapBoleto(r),
      ref: r.domPaymentLinkId
        ? { kind: 'PAYMENT_LINK' as const, externalId: r.domPaymentLinkId }
        : undefined,
    })),
  ].map(withOwner);
  return { candidates, userIds: new Set(roles.keys()) };
}

export function decide(
  candidates: Candidate[],
  userIds: Set<string>,
  offers: {
    code: string;
    legacyType: string | null;
    legacyId: string | null;
  }[],
  preflight: PreflightMap = new Map(),
): Decision[] {
  const existingLegacy = new Set(
    offers
      .filter((o) => o.legacyType && o.legacyId)
      .map((o) => key(o.legacyType!, o.legacyId!)),
  );
  const codeHolder = new Map(
    offers.map((o) => [
      o.code,
      o.legacyType && o.legacyId ? key(o.legacyType, o.legacyId) : '(manual)',
    ]),
  );
  const batch = new Map<string, number>();
  for (const { draft } of candidates)
    if (
      draft.code &&
      !existingLegacy.has(key(draft.legacyType, draft.legacyId))
    )
      batch.set(draft.code, (batch.get(draft.code) ?? 0) + 1);

  return candidates.map((candidate) => {
    const d = candidate.draft;
    const k = key(d.legacyType, d.legacyId);
    const pre = preflight.get(k);
    const warnings = [...d.notes, ...(pre?.notes ?? [])];
    if (d.amountCents !== null && d.amountCents < MIN_AMOUNT_CENTS)
      warnings.push(`BELOW_MINIMUM_AMOUNT: ${d.amountCents} cents`);
    const make = (status: Status, reasons: string[] = []): Decision => ({
      candidate,
      status,
      reasons,
      warnings,
    });
    // Blockers win over SKIP_EXISTING: a product that now carries live data is surfaced.
    if (pre?.blockers.length)
      return make(
        'BLOCKED',
        pre.blockers.map((b) => `${b.code}: ${b.detail}`),
      );
    if (existingLegacy.has(k)) return make('SKIP_EXISTING');
    if (candidate.ownerRole === 'ADMIN')
      return make('BLOCKED_ADMIN_OWNER', [
        'owner is ADMIN (plan 0009); owners are never reassigned here',
      ]);
    // INVALID_FULFILLMENT / INVALID_BOLETO_DUE_DAYS are reported with their detailed reason.
    const reasons: string[] = [
      ...d.issues.filter(
        (i) => i !== 'INVALID_FULFILLMENT' && i !== 'INVALID_BOLETO_DUE_DAYS',
      ),
      ...d.issueDetails,
    ];
    if (d.ownerUserId && !userIds.has(d.ownerUserId))
      reasons.push('MISSING_OWNER');
    if (d.code) {
      const holder = codeHolder.get(d.code);
      if (holder && holder !== k)
        reasons.push(`DUPLICATE_CODE: held by Offer ${holder}`);
      else if ((batch.get(d.code) ?? 0) > 1)
        reasons.push('DUPLICATE_CODE: shared by several legacy rows');
    }
    return reasons.length
      ? make('REFUSED', [...new Set(reasons)])
      : make('CREATE');
  });
}

const offerData = (d: OfferDraft): Prisma.OfferUncheckedCreateInput => ({
  ownerUserId: d.ownerUserId!,
  createdByUserId: d.createdByUserId ?? d.ownerUserId!,
  platformTag: d.platformTag,
  code: d.code!,
  kind: d.kind,
  name: d.name,
  description: d.description,
  amountCents: d.amountCents!,
  isActive: d.isActive,
  acceptedMethods: d.acceptedMethods,
  maxInstallments: d.maxInstallments,
  expiresAt: d.expiresAt,
  maxUses: d.maxUses,
  usedCount: d.usedCount,
  accessDays: d.accessDays,
  renewalMode: d.renewalMode,
  intervalType: d.intervalType,
  intervalCount: d.intervalCount,
  repetitions: d.repetitions,
  retryDays: d.retryDays,
  fulfillment: d.fulfillment ?? Prisma.DbNull,
  metadata: (d.metadata as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
  legacyType: d.legacyType,
  legacyId: d.legacyId,
});

export type Plan = { decisions: Decision[]; existingOffers: number };

export async function buildPlan(db: Reader): Promise<Plan> {
  const { candidates, userIds } = await loadCandidates(db);
  const offers = await db.offer.findMany({
    select: { code: true, legacyType: true, legacyId: true },
  });
  return {
    decisions: decide(
      candidates,
      userIds,
      offers,
      await findPreflight(
        db,
        candidates.map((c) => c.draft),
      ),
    ),
    existingOffers: offers.length,
  };
}

export type ApplyResult = {
  created: number;
  refs: number;
  perKind: Record<string, { created: number; refs: number }>;
};

/** One transaction per legacy kind; a failure rolls back only that kind. */
export async function applyPlan(
  prisma: PrismaClient,
  plan: Plan,
  log: (line: string) => void = () => {},
): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, refs: 0, perKind: {} };
  for (const type of KIND_ORDER) {
    const mine = plan.decisions.filter(
      (d) => d.candidate.draft.legacyType === type,
    );
    const stats = { created: 0, refs: 0 };
    await prisma.$transaction(
      async (tx) => {
        const needsRef = mine.some(
          (d) =>
            (d.status === 'CREATE' || d.status === 'SKIP_EXISTING') &&
            d.candidate.ref,
        );
        if (needsRef) {
          const acquirer = await tx.acquirerCatalogue.findUnique({
            where: { code: ACQUIRER_CODE },
          });
          if (!acquirer)
            throw new Error(
              `AcquirerCatalogue ${ACQUIRER_CODE} is missing; ExternalRef cannot be written. Nothing was written for ${type}.`,
            );
        }
        for (const d of mine) {
          if (d.status !== 'CREATE' && d.status !== 'SKIP_EXISTING') continue;
          const draft = d.candidate.draft;
          let offerId: string | undefined;
          if (d.status === 'CREATE') {
            const created = await tx.offer.create({
              data: offerData(draft),
              select: { id: true },
            });
            offerId = created.id;
            stats.created++;
          } else if (d.candidate.ref) {
            offerId = (
              await tx.offer.findUnique({
                where: {
                  legacyType_legacyId: {
                    legacyType: draft.legacyType,
                    legacyId: draft.legacyId,
                  },
                },
                select: { id: true },
              })
            )?.id;
          }
          const ref = d.candidate.ref;
          if (!ref || !offerId) continue;
          const where = {
            acquirerCode_kind_externalId: {
              acquirerCode: ACQUIRER_CODE,
              kind: ref.kind,
              externalId: ref.externalId,
            },
          };
          const existing = await tx.externalRef.findUnique({ where });
          if (existing) {
            if (
              existing.entityType !== 'Offer' ||
              existing.entityId !== offerId
            )
              throw new Error(
                `ExternalRef ${ref.kind}/${ref.externalId} already points to ${existing.entityType}:${existing.entityId}`,
              );
            continue;
          }
          await tx.externalRef.create({
            data: {
              acquirerCode: ACQUIRER_CODE,
              kind: ref.kind,
              externalId: ref.externalId,
              entityType: 'Offer',
              entityId: offerId,
            },
          });
          stats.refs++;
        }
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
    result.perKind[type] = stats;
    result.created += stats.created;
    result.refs += stats.refs;
    log(`  ${type}: ${stats.created} offers, ${stats.refs} external refs`);
  }
  return result;
}

/** Key-sorted JSON so that stored JSON and drafts compare regardless of key order. */
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(value ?? null));
}

/** Compares legacy rows with Offers (counts, cents, codes, owners, external refs). */
export async function verify(db: Reader): Promise<string[]> {
  const plan = await buildPlan(db);
  const offers = await db.offer.findMany({
    where: { legacyType: { not: null } },
  });
  const byLegacy = new Map(
    offers.map((o) => [key(o.legacyType!, o.legacyId!), o]),
  );
  const refs = await db.externalRef.findMany({
    where: { entityType: 'Offer', acquirerCode: ACQUIRER_CODE },
  });
  const refKeys = new Set(
    refs.map((r) => `${r.kind}:${r.externalId}:${r.entityId}`),
  );
  const problems: string[] = [];
  const expectedKeys = new Set<string>();
  for (const type of KIND_ORDER) {
    const eligible = plan.decisions.filter(
      (d) =>
        d.candidate.draft.legacyType === type &&
        (d.status === 'CREATE' || d.status === 'SKIP_EXISTING'),
    );
    const actual = offers.filter((o) => o.legacyType === type).length;
    if (actual !== eligible.length)
      problems.push(
        `${type}: ${eligible.length} eligible legacy rows but ${actual} Offers`,
      );
    for (const d of eligible) {
      const draft = d.candidate.draft;
      const k = key(draft.legacyType, draft.legacyId);
      expectedKeys.add(k);
      const offer = byLegacy.get(k);
      if (!offer) {
        problems.push(`${k}: Offer missing`);
        continue;
      }
      if (offer.amountCents !== draft.amountCents)
        problems.push(
          `${k}: amountCents ${offer.amountCents} != legacy ${draft.amountCents}`,
        );
      if (offer.code !== draft.code)
        problems.push(`${k}: code ${offer.code} != legacy ${draft.code}`);
      if (offer.ownerUserId !== draft.ownerUserId)
        problems.push(
          `${k}: owner ${offer.ownerUserId} != legacy ${draft.ownerUserId}`,
        );
      if (canonical(offer.fulfillment) !== canonical(draft.fulfillment))
        problems.push(
          `${k}: fulfillment ${canonical(offer.fulfillment)} != legacy ${canonical(draft.fulfillment)}`,
        );
      if (canonical(offer.metadata) !== canonical(draft.metadata))
        problems.push(
          `${k}: metadata ${canonical(offer.metadata)} != legacy ${canonical(draft.metadata)}`,
        );
      const ref = d.candidate.ref;
      if (ref && !refKeys.has(`${ref.kind}:${ref.externalId}:${offer.id}`))
        problems.push(
          `${k}: ExternalRef ${ref.kind}/${ref.externalId} missing`,
        );
    }
  }
  for (const o of offers)
    if (!expectedKeys.has(key(o.legacyType!, o.legacyId!)))
      problems.push(
        `${o.legacyType}:${o.legacyId}: Offer ${o.id} has no eligible legacy row`,
      );
  return problems;
}

export function printPlan(
  plan: Plan,
  log: (line: string) => void = console.log,
) {
  const count = (s: Status) =>
    plan.decisions.filter((d) => d.status === s).length;
  log(`Existing Offer rows: ${plan.existingOffers}`);
  log(
    `Plan: ${count('CREATE')} to create, ${count('SKIP_EXISTING')} already migrated, ${count('REFUSED')} refused, ${count('BLOCKED_ADMIN_OWNER')} BLOCKED (admin owner), ${count('BLOCKED')} BLOCKED (would lose data)`,
  );
  for (const type of KIND_ORDER) {
    const mine = plan.decisions.filter(
      (d) => d.candidate.draft.legacyType === type,
    );
    log(`\n${type} (${mine.length})`);
    for (const d of mine) {
      const draft = d.candidate.draft;
      const label = `${draft.legacyId} code=${draft.code ?? '-'} cents=${draft.amountCents ?? '-'}`;
      const reasons = d.reasons.length ? ` [${d.reasons.join('; ')}]` : '';
      const warns = d.warnings.length
        ? ` (warn: ${d.warnings.join('; ')})`
        : '';
      const status = d.status.startsWith('BLOCKED') ? 'BLOCKED' : d.status;
      log(`  ${status.padEnd(13)} ${label}${reasons}${warns}`);
    }
  }
}

async function exitIfBlocked(prisma: PrismaClient, options: CliOptions) {
  const plan = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return buildPlan(tx);
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
  const blocked = countBlocked(plan);
  if (blocked && !options.allowBlocked) {
    console.error(
      `${blocked} product(s) are BLOCKED and were not migrated (use --allow-blocked to accept).`,
    );
    process.exitCode = 1;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeTarget(options.databaseUrl)}`);
  const mode = options.verify
    ? 'VERIFY'
    : options.apply
      ? 'APPLY (writes)'
      : 'DRY RUN';
  console.log(`Mode: ${mode}`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: options.databaseUrl, max: 2 }),
  });
  try {
    if (options.verify) {
      const problems = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          return verify(tx);
        },
        { timeout: 120_000, maxWait: 15_000 },
      );
      if (problems.length) {
        console.error(`VERIFY FAILED: ${problems.length} mismatch(es)`);
        for (const p of problems) console.error(`  ${p}`);
        process.exitCode = 1;
      } else console.log('VERIFY OK: legacy rows and Offers match.');
      await exitIfBlocked(prisma, options);
      return;
    }
    const plan = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return buildPlan(tx);
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
    printPlan(plan);
    if (!options.apply) {
      console.log('\nDry run: nothing was written.');
      if (countBlocked(plan))
        console.log(
          `${countBlocked(plan)} product(s) are BLOCKED and will not be migrated.`,
        );
      return;
    }
    console.log('\nApplying (one transaction per kind)...');
    const result = await applyPlan(prisma, plan, console.log);
    console.log(
      `Done: ${result.created} offers, ${result.refs} external refs.`,
    );
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
