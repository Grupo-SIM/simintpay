/**
 * Migrates legacy PENDING PIX SubscriptionLinkOrder rows (DOM Pix already issued, no DOM
 * subscription) to the offer model, so that when DOM confirms the payment the webhook settles
 * through the offer path (Transaction -> markChargeSettled -> Charge PAID -> contract ACTIVE).
 *
 * Per order it writes what OfferSubscribeService writes before a PIX is paid:
 *   - BillingContract INACTIVE (no paid cycle yet), key `offerId:email`, nextChargeAt = trial end;
 *   - Charge PENDING (method PIX, first cycle) bound to the Transaction;
 *   - Transaction PENDING / FINAL_NET with offerId and the DOM payment id (`domPaymentId`), the
 *     reference the DOM webhook and the reconciliation already resolve. A PENDING Transaction that
 *     the reconciliation already opened for the order is adopted instead of duplicated;
 *   - the order status becomes `migrated`, which makes the legacy webhook handler skip it.
 * Paid, expired, failed or refunded orders are ignored. Orders without a DOM Pix payment, without
 * a financial snapshot, whose offer is missing/not recurring, or that duplicate a contract key are
 * reported and left untouched.
 *
 *   # dry run (default): runs everything in a transaction, prints the plan, ROLLS BACK
 *   bun --no-env-file scripts/offer-pending-order-migration.ts --database-url=postgresql://...
 *   # write
 *   bun --no-env-file scripts/offer-pending-order-migration.ts --database-url=... --apply --i-understand-this-writes
 *   # read-only consistency checks; exit code 1 on any mismatch
 *   bun --no-env-file scripts/offer-pending-order-migration.ts --database-url=... --verify
 *
 * The database must be given with `--database-url`; `DATABASE_URL` and `.env` are never read.
 * The transaction aborts if wallet balances, BalanceLog, CoproductionAllocation, any pre-existing
 * Transaction (other than an adopted one) or any order other than the migrated ones changed.
 */
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { MIGRATED_ORDER_STATUS } from '../src/modules/billing-core/legacy-order-migration';
import {
  openFinancialSubscriptionIn,
  quoteFinancialSubscription,
} from '../src/modules/financial-policy/financial-subscription';
import { loadPlatformChargeContext } from '../src/modules/financial-policy/financial-charge';
import { describeTarget, parseArgs } from './offer-contract-migration';

export { describeTarget, parseArgs };

type Tx = Prisma.TransactionClient;
type Quote = NonNullable<
  Awaited<ReturnType<typeof quoteFinancialSubscription>>
>;

const MIGRATED_BY = 'offer-pending-order-migration';
const DAY = 86_400_000;

export type Decision =
  | 'MIGRATE'
  | 'NO_PIX_PAYMENT'
  | 'NO_FINANCIAL_SNAPSHOT'
  | 'SNAPSHOT_INVALID'
  | 'OFFER_MISSING'
  | 'OFFER_NOT_RECURRING'
  | 'ALREADY_MIGRATED'
  | 'TRANSACTION_NOT_PENDING'
  | 'TRANSACTION_OTHER_OFFER'
  | 'DUPLICATE_CONTRACT_KEY'
  | 'CONTRACT_KEY_TAKEN';

type OrderRow = Prisma.SubscriptionLinkOrderGetPayload<{
  include: { subscriptionLink: { select: { name: true } } };
}>;
type OfferRow = Prisma.OfferGetPayload<object>;

export type Plan = {
  order: OrderRow;
  decision: Decision;
  detail?: string;
  offer?: OfferRow;
  quote?: Quote;
  /** Transaction the reconciliation already opened for this order's DOM payment. */
  adoptedTransactionId?: string;
  /** Adopted Transaction, or the id the new one will get. */
  transactionId?: string;
  resourceId?: string;
};

export type Snapshot = {
  walletBalance: string;
  walletLocked: string;
  balanceLogs: number;
  allocations: number;
  transactions: number;
};

export async function snapshot(tx: Tx): Promise<Snapshot> {
  const [row] = await tx.$queryRawUnsafe<Snapshot[]>(`
    SELECT
      (SELECT COALESCE(sum(balance), 0) FROM "Wallet")::text AS "walletBalance",
      (SELECT COALESCE(sum("lockedBalance"), 0) FROM "Wallet")::text AS "walletLocked",
      (SELECT count(*) FROM "BalanceLog")::int AS "balanceLogs",
      (SELECT count(*) FROM "CoproductionAllocation")::int AS "allocations",
      (SELECT count(*) FROM "Transaction")::int AS "transactions"`);
  return row;
}

/** md5 of every row except the ones the migration is allowed to touch. */
async function digests(tx: Tx, orderIds: string[], transactionIds: string[]) {
  const [row] = await tx.$queryRawUnsafe<
    { orders: string; transactions: string }[]
  >(
    `SELECT
      (SELECT md5(COALESCE(string_agg(o::text, '|' ORDER BY o.id), ''))
         FROM "SubscriptionLinkOrder" o WHERE o.id <> ALL($1::text[])) AS orders,
      (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), ''))
         FROM "Transaction" t WHERE t.id <> ALL($2::text[])) AS transactions`,
    orderIds,
    transactionIds,
  );
  return row;
}

const cents = (value: Prisma.Decimal | number) =>
  Math.round(Number(value) * 100);

/** Read-only: decides what happens to every candidate order. */
export async function planMigration(tx: Tx): Promise<Plan[]> {
  const orders = await tx.subscriptionLinkOrder.findMany({
    where: {
      status: 'pending',
      paymentMethod: 'PIX',
      domSubscriptionId: null,
    },
    include: { subscriptionLink: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const plans: Plan[] = [];
  const taken = new Set<string>();
  for (const order of orders) {
    const plan = await classify(tx, order, taken);
    if (plan.decision === 'MIGRATE') taken.add(plan.resourceId!);
    plans.push(plan);
  }
  return plans;
}

async function classify(
  tx: Tx,
  order: OrderRow,
  taken: Set<string>,
): Promise<Plan> {
  const skip = (decision: Decision, detail?: string): Plan => ({
    order,
    decision,
    detail,
  });
  if (!order.domPixPaymentId)
    return skip('NO_PIX_PAYMENT', 'order has no DOM Pix payment id');
  if (!order.financialSnapshot)
    return skip('NO_FINANCIAL_SNAPSHOT', 'order has no financial snapshot');
  const offer = await tx.offer.findFirst({
    where: {
      OR: [
        { id: order.subscriptionLinkId },
        { legacyType: 'SubscriptionLink', legacyId: order.subscriptionLinkId },
      ],
    },
  });
  if (!offer) return skip('OFFER_MISSING', order.subscriptionLinkId);
  if (
    offer.renewalMode === 'NONE' ||
    !offer.intervalType ||
    !offer.intervalCount
  )
    return skip('OFFER_NOT_RECURRING', offer.id);
  let quote: Quote | null;
  try {
    quote = await quoteFinancialSubscription(tx, {
      snapshot: order.financialSnapshot,
      amount: order.amountCharged,
    });
  } catch (error) {
    return skip(
      'SNAPSHOT_INVALID',
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!quote) return skip('NO_FINANCIAL_SNAPSHOT', 'snapshot not restorable');

  const email = order.customerEmail.trim().toLowerCase();
  const resourceId = `${offer.id}:${email}`;
  const byOrder = await tx.billingContract.findFirst({
    where: { metadata: { path: ['legacyOrderId'], equals: order.id } },
    select: { id: true },
  });
  if (byOrder) return skip('ALREADY_MIGRATED', `contract ${byOrder.id}`);

  const existing = await tx.transaction.findUnique({
    where: { domPaymentId: order.domPixPaymentId },
    include: { charge: { select: { id: true } } },
  });
  if (existing?.charge)
    return skip('ALREADY_MIGRATED', `charge ${existing.charge.id}`);
  if (
    existing &&
    (existing.status !== 'PENDING' || existing.settlementBasis !== 'FINAL_NET')
  )
    return skip(
      'TRANSACTION_NOT_PENDING',
      `transaction ${existing.id} is ${existing.status}/${existing.settlementBasis}`,
    );
  if (existing?.offerId && existing.offerId !== offer.id)
    return skip(
      'TRANSACTION_OTHER_OFFER',
      `transaction ${existing.id} belongs to offer ${existing.offerId}`,
    );

  if (taken.has(resourceId))
    return skip(
      'DUPLICATE_CONTRACT_KEY',
      `${resourceId} (an earlier order wins)`,
    );
  const contract = await tx.billingContract.findUnique({
    where: {
      resourceType_resourceId: { resourceType: 'OFFER', resourceId },
    },
    select: { id: true, status: true },
  });
  if (contract)
    return skip(
      'CONTRACT_KEY_TAKEN',
      `contract ${contract.id} (${contract.status})`,
    );

  return {
    order,
    decision: 'MIGRATE',
    offer,
    quote,
    adoptedTransactionId: existing?.id,
    transactionId: existing?.id ?? randomUUID(),
    resourceId,
  };
}

async function acquirerOf(tx: Tx, offer: OfferRow): Promise<string> {
  const tag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
  return (await loadPlatformChargeContext(tx, tag))?.acquirer ?? 'DOM';
}

/** Writes contract + Charge + Transaction for one MIGRATE plan and marks the order. */
async function migrateOne(tx: Tx, plan: Plan) {
  const { order, offer, quote } = plan;
  const o = offer!;
  const q = quote!;
  const paymentId = order.domPixPaymentId!;
  const email = order.customerEmail.trim().toLowerCase();
  // The contract is created as OfferSubscribeService would have at checkout time.
  const startedAt = order.createdAt;
  const trialEnd = new Date(startedAt.getTime() + (o.trialDays ?? 0) * DAY);
  const acquirer = await acquirerOf(tx, o);

  const transactionId = plan.transactionId!;
  if (plan.adoptedTransactionId)
    await tx.transaction.update({
      where: { id: transactionId },
      data: { offerId: o.id },
    });
  else {
    await openFinancialSubscriptionIn(tx, {
      snapshot: order.financialSnapshot,
      amount: order.amountCharged,
      paymentId,
      userId: order.userId,
      method: 'PIX',
      name: order.subscriptionLink.name,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerDocument: order.customerDocument,
      tracking: order.tracking,
      pixContent: order.pixContent,
      pixExpire: order.pixExpire,
      createdAt: order.createdAt,
      offerId: o.id,
      transactionId,
    });
  }

  const contract = await tx.billingContract.create({
    data: {
      userId: o.ownerUserId,
      resourceType: 'OFFER',
      resourceId: plan.resourceId!,
      unitAmount: new Prisma.Decimal(o.amountCents).div(100),
      quantity: 1,
      intervalType: o.intervalType!,
      intervalCount: o.intervalCount!,
      currentPeriodStart: startedAt,
      currentPeriodEnd: trialEnd,
      status: 'INACTIVE',
      offerId: o.id,
      nextChargeAt: trialEnd,
      customerName: order.customerName,
      customerEmail: email,
      customerDocument: order.customerDocument,
      acquirer: acquirer as never,
      description: o.name.slice(0, 120),
      metadata: { legacyOrderId: order.id, migratedBy: MIGRATED_BY },
    },
  });
  await tx.charge.create({
    data: {
      offerId: o.id,
      contractId: contract.id,
      ownerUserId: o.ownerUserId,
      amountCents: cents(q.totalAmount),
      currency: o.currency,
      status: 'PENDING',
      method: 'PIX',
      dueAt: trialEnd,
      cycleKey: trialEnd.toISOString(),
      attempts: 1,
      customerName: order.customerName,
      customerEmail: email,
      customerDocument: order.customerDocument,
      transactionId,
      snapshot: {
        baseAmountCents: o.amountCents,
        installments: 1,
        totalFee: q.totalFeeAmount,
        domFee: q.domFeeAmount ?? 0,
        platformFee: q.platformProfit ?? 0,
        netAmount: q.netAmount,
        acquirer,
        firstCycle: true,
        financial: (order.financialSnapshot ?? null) as Prisma.InputJsonValue,
        legacyOrderId: order.id,
      },
    },
  });
  await tx.subscriptionLinkOrder.update({
    where: { id: order.id },
    data: { status: MIGRATED_ORDER_STATUS },
  });
  return { contractId: contract.id, transactionId };
}

export type MigrationResult = {
  plans: Plan[];
  migrated: { orderId: string; contractId: string; transactionId: string }[];
  ignored: { status: string; orders: number }[];
  before: Snapshot;
};

/** Runs inside the caller's transaction. Throws if protected data changed. */
export async function runMigration(tx: Tx): Promise<MigrationResult> {
  const before = await snapshot(tx);
  const plans = await planMigration(tx);
  const todo = plans.filter((p) => p.decision === 'MIGRATE');
  const orderIds = todo.map((p) => p.order.id);
  const touched = todo.map((p) => p.transactionId!);
  const beforeDigest = await digests(tx, orderIds, touched);
  const migrated: MigrationResult['migrated'] = [];
  for (const plan of todo) {
    const done = await migrateOne(tx, plan);
    migrated.push({ orderId: plan.order.id, ...done });
  }
  const after = await snapshot(tx);
  const afterDigest = await digests(tx, orderIds, touched);
  const created = todo.filter((p) => !p.adoptedTransactionId).length;
  const changed = (Object.keys(before) as (keyof Snapshot)[]).flatMap((k) => {
    const expected = k === 'transactions' ? before[k] + created : before[k];
    return expected === after[k] ? [] : [`${k}: ${expected} -> ${after[k]}`];
  });
  if (beforeDigest.orders !== afterDigest.orders)
    changed.push('a SubscriptionLinkOrder outside the migrated ones changed');
  if (beforeDigest.transactions !== afterDigest.transactions)
    changed.push('a pre-existing Transaction (not adopted) changed');
  if (changed.length)
    throw new Error(
      `Protected data changed, aborting (nothing was written): ${changed.join('; ')}`,
    );
  const ignored = await tx.subscriptionLinkOrder.groupBy({
    by: ['status'],
    where: {
      paymentMethod: 'PIX',
      domSubscriptionId: null,
      status: { notIn: ['pending', MIGRATED_ORDER_STATUS] },
    },
    _count: { _all: true },
    orderBy: { status: 'asc' },
  });
  return {
    plans,
    migrated,
    ignored: ignored.map((r) => ({ status: r.status, orders: r._count._all })),
    before,
  };
}

export type VerifyRow = { check: string; order_id: string; detail: string };

/** Read-only. Returns rows only on mismatch. */
export async function runVerify(tx: Tx): Promise<VerifyRow[]> {
  const rows: VerifyRow[] = [];
  const orders = await tx.subscriptionLinkOrder.findMany({
    where: { status: MIGRATED_ORDER_STATUS },
  });
  for (const order of orders) {
    const bad = (check: string, detail: string) =>
      rows.push({ check, order_id: order.id, detail });
    const contracts = await tx.billingContract.findMany({
      where: { metadata: { path: ['legacyOrderId'], equals: order.id } },
      include: { charges: { include: { transaction: true } } },
    });
    if (contracts.length !== 1) {
      bad('CONTRACT_COUNT', `${contracts.length} contracts for the order`);
      continue;
    }
    const [contract] = contracts;
    if (contract.charges.length !== 1) {
      bad('CHARGE_COUNT', `${contract.charges.length} charges`);
      continue;
    }
    const [charge] = contract.charges;
    const t = charge.transaction;
    if (!t || t.domPaymentId !== order.domPixPaymentId)
      bad('TRANSACTION_MISMATCH', `charge ${charge.id} -> ${t?.domPaymentId}`);
    if (!t) continue;
    if (t.offerId !== contract.offerId)
      bad(
        'OFFER_MISMATCH',
        `transaction ${t.offerId} contract ${contract.offerId}`,
      );
    if (charge.offerId !== contract.offerId)
      bad(
        'OFFER_MISMATCH',
        `charge ${charge.offerId} contract ${contract.offerId}`,
      );
    if (
      charge.amountCents !== cents(t.amount) ||
      cents(t.amount) !== cents(order.amountCharged)
    )
      bad(
        'AMOUNT_MISMATCH',
        `charge ${charge.amountCents} transaction ${t.amount} order ${order.amountCharged}`,
      );
    if (t.status === 'PENDING' && charge.status !== 'PENDING')
      bad('STATE_MISMATCH', `transaction PENDING, charge ${charge.status}`);
    if (t.status === 'COMPLETED' && charge.status !== 'PAID')
      bad('STATE_MISMATCH', `transaction COMPLETED, charge ${charge.status}`);
    if (charge.status === 'PENDING' && contract.status !== 'INACTIVE')
      bad('STATE_MISMATCH', `charge PENDING, contract ${contract.status}`);
    if (charge.status === 'PAID' && contract.status !== 'ACTIVE')
      bad('STATE_MISMATCH', `charge PAID, contract ${contract.status}`);
  }
  return rows;
}

class DryRunRollback extends Error {
  constructor(readonly result: MigrationResult) {
    super('dry-run rollback');
  }
}

const TX_OPTIONS = {
  timeout: 120_000,
  maxWait: 15_000,
  isolationLevel: 'RepeatableRead' as const,
};

function printResult(result: MigrationResult, verb: string) {
  console.log('Orders by decision:');
  const counts = new Map<string, number>();
  for (const p of result.plans)
    counts.set(p.decision, (counts.get(p.decision) ?? 0) + 1);
  for (const [decision, n] of [...counts].sort())
    console.log(`  ${decision.padEnd(26)} ${n}`);
  for (const r of result.ignored)
    console.log(`  ${`IGNORED (status ${r.status})`.padEnd(26)} ${r.orders}`);
  console.log('Per order:');
  for (const p of result.plans)
    console.log(
      `  ${p.order.id} pix=${p.order.domPixPaymentId ?? '-'} ` +
        `R$ ${p.order.amountCharged} ${p.decision}` +
        `${p.adoptedTransactionId ? ` (adopts transaction ${p.adoptedTransactionId})` : ''}` +
        `${p.detail ? ` - ${p.detail}` : ''}`,
    );
  console.log(
    `${verb}: ${result.migrated.length} order(s) -> contract + pending charge + pending transaction.`,
  );
  console.log(
    `Protected data unchanged: wallet balance ${result.before.walletBalance}, ` +
      `locked ${result.before.walletLocked}, BalanceLog ${result.before.balanceLogs}, ` +
      `CoproductionAllocation ${result.before.allocations}.`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeTarget(options.databaseUrl)}`);
  console.log(
    `Mode: ${options.verify ? 'VERIFY' : options.apply ? 'APPLY (writes)' : 'DRY RUN'}`,
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: options.databaseUrl, max: 2 }),
  });
  try {
    if (options.verify) {
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return runVerify(tx);
      }, TX_OPTIONS);
      if (rows.length) {
        console.error(`VERIFY FAILED: ${rows.length} mismatch(es)`);
        for (const r of rows)
          console.error(`  ${r.check} order=${r.order_id} ${r.detail}`);
        process.exitCode = 1;
      } else console.log('VERIFY OK: migrated orders are consistent.');
      return;
    }
    if (options.apply) {
      const result = await prisma.$transaction(
        (tx) => runMigration(tx),
        TX_OPTIONS,
      );
      printResult(result, 'Applied');
      return;
    }
    try {
      await prisma.$transaction(async (tx) => {
        throw new DryRunRollback(await runMigration(tx));
      }, TX_OPTIONS);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
      printResult(error.result, 'Would migrate');
      console.log('\nDry run: transaction rolled back, nothing was written.');
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
