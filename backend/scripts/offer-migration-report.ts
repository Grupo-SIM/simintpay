/**
 * DRY-RUN-ONLY report of the legacy products that would become `Offer` rows (plan 0021). Never writes.
 *
 *   bun --no-env-file scripts/offer-migration-report.ts --database-url=postgresql://... [--json]
 *   OFFER_REPORT_DATABASE_URL=postgresql://... bun --no-env-file scripts/offer-migration-report.ts
 *
 * The database must be given explicitly; `DATABASE_URL` and `.env` are intentionally never read.
 * The host is printed before any query, and all reads run in one `SET TRANSACTION READ ONLY` transaction.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import {
  mapBoleto,
  mapPaymentLink,
  mapPixCreditPlan,
  mapPlan,
  mapSubscriptionLink,
  type OfferDraft,
} from '../src/modules/offer/legacy-offer-mapper';

export const MIN_AMOUNT_CENTS = 1499;

export function resolveDatabaseUrl(
  argv: string[],
  env: Record<string, string | undefined>,
): string {
  let fromFlag: string | undefined;
  argv.forEach((arg, i) => {
    if (arg.startsWith('--database-url='))
      fromFlag = arg.slice('--database-url='.length);
    else if (arg === '--database-url') fromFlag = argv[i + 1];
  });
  const url = (fromFlag ?? env.OFFER_REPORT_DATABASE_URL)?.trim();
  if (!url || url.startsWith('--'))
    throw new Error(
      'Refusing to run: pass --database-url=<url> or set OFFER_REPORT_DATABASE_URL. DATABASE_URL and .env are never used.',
    );
  return url;
}

export function describeTarget(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

export type Conflicts = {
  duplicateCodes: { code: string; sources: string[] }[];
  missingOwner: string[];
  missingCode: string[];
  invalidAmount: string[];
  adminOwner: string[];
  belowMinimumAmount: string[];
  notes: string[];
};

const ref = (d: OfferDraft) => `${d.legacyType}:${d.legacyId}`;

export function findConflicts(
  drafts: OfferDraft[],
  roleByUser: Map<string, string>,
  existingUsers: Set<string>,
): Conflicts {
  const byCode = new Map<string, string[]>();
  const out: Conflicts = {
    duplicateCodes: [],
    missingOwner: [],
    missingCode: [],
    invalidAmount: [],
    adminOwner: [],
    belowMinimumAmount: [],
    notes: [],
  };
  for (const d of drafts) {
    if (d.code) byCode.set(d.code, [...(byCode.get(d.code) ?? []), ref(d)]);
    else out.missingCode.push(ref(d));
    if (!d.ownerUserId || !existingUsers.has(d.ownerUserId))
      out.missingOwner.push(ref(d));
    else if (roleByUser.get(d.ownerUserId) === 'ADMIN')
      out.adminOwner.push(ref(d));
    for (const n of d.notes) out.notes.push(`${ref(d)} ${n}`);
    if (d.amountCents === null) out.invalidAmount.push(ref(d));
    else if (d.amountCents < MIN_AMOUNT_CENTS)
      out.belowMinimumAmount.push(ref(d));
  }
  for (const [code, sources] of byCode)
    if (sources.length > 1) out.duplicateCodes.push({ code, sources });
  return out;
}

async function main() {
  const url = resolveDatabaseUrl(process.argv.slice(2), process.env);
  console.log(`Target database: ${describeTarget(url)}`);
  console.log('Mode: DRY RUN, read-only transaction, no writes.');

  const pool = new Pool({ connectionString: url, max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const data = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return {
          paymentLinks: await tx.paymentLink.findMany(),
          subscriptionLinks: await tx.subscriptionLink.findMany(),
          plans: await tx.plan.findMany(),
          pixPlans: await tx.pixCreditPlan.findMany({
            include: { linkCodes: true },
          }),
          boletos: await tx.boleto.findMany(),
          users: await tx.user.findMany({ select: { id: true, role: true } }),
          existingOffers: await tx.offer.count(),
        };
      },
      { timeout: 120_000, maxWait: 15_000 },
    );

    const drafts: OfferDraft[] = [
      ...data.paymentLinks.map(mapPaymentLink),
      ...data.subscriptionLinks.map(mapSubscriptionLink),
      ...data.plans.map(mapPlan),
      ...data.pixPlans.map(mapPixCreditPlan),
      ...data.boletos.map(mapBoleto),
    ];
    const conflicts = findConflicts(
      drafts,
      new Map(data.users.map((u) => [u.id, String(u.role)])),
      new Set(data.users.map((u) => u.id)),
    );
    const perKind: Record<string, number> = {};
    for (const d of drafts) perKind[d.kind] = (perKind[d.kind] ?? 0) + 1;

    const report = {
      source: {
        PaymentLink: data.paymentLinks.length,
        SubscriptionLink: data.subscriptionLinks.length,
        Plan: data.plans.length,
        PixCreditPlan: data.pixPlans.length,
        Boleto: data.boletos.length,
      },
      existingOffers: data.existingOffers,
      draftsTotal: drafts.length,
      draftsPerKind: perKind,
      conflicts,
    };
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('\nLegacy rows:', report.source);
      console.log('Existing Offer rows:', report.existingOffers);
      console.log(`Would-be Offer drafts: ${report.draftsTotal}`, perKind);
      console.log('\nConflicts');
      console.log(
        `  duplicate codes:        ${conflicts.duplicateCodes.length}`,
      );
      for (const c of conflicts.duplicateCodes)
        console.log(`    ${c.code}: ${c.sources.join(', ')}`);
      console.log(`  missing owner:          ${conflicts.missingOwner.length}`);
      console.log(`  admin owner (0009):     ${conflicts.adminOwner.length}`);
      console.log(
        `  amount < ${MIN_AMOUNT_CENTS} cents:   ${conflicts.belowMinimumAmount.length}`,
      );
      console.log(
        `  invalid amount:         ${conflicts.invalidAmount.length}`,
      );
      console.log(`  missing code:           ${conflicts.missingCode.length}`);
      for (const [label, list] of [
        ['missing owner', conflicts.missingOwner],
        ['admin owner', conflicts.adminOwner],
        ['amount below minimum', conflicts.belowMinimumAmount],
        ['invalid amount', conflicts.invalidAmount],
        ['missing code', conflicts.missingCode],
        ['notes', conflicts.notes],
      ] as const)
        if (list.length) console.log(`  ${label}: ${list.join(', ')}`);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
