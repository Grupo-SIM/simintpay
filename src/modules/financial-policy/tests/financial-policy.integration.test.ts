import { afterAll, expect, test } from 'bun:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { emptyPolicy, laneKey, METHODS, CHANNELS } from '../financial-policy';
import { getFinancialPolicy, saveFinancialPolicy, simulateFinancialPolicy } from '../financial-policy.service';
import { loadChargePolicy, quoteFinancialCharge, quoteReportedPos, restoreFinancialCharge } from '../financial-charge';
import { settleFinancialSubscription } from '../financial-subscription';
import { persistLinkCharge, settleFinalNet } from '../../platform-core/link-settlement';

const connectionString = process.env.FINANCIAL_POLICY_TEST_DATABASE_URL;
if (connectionString && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname)) throw new Error('Financial integration tests require a local database');
const prisma = connectionString ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) : null;
afterAll(async () => { await prisma?.$disconnect(); });

test.skipIf(!prisma)('real local database: migration audit, policy revisions, quote, idempotent settlement and refund', async () => {
  const db = prisma!;
  const legacy = await db.transaction.findUniqueOrThrow({ where: { id: 'finance-historic-tx' } });
  expect(legacy.netAmount?.toNumber()).toBe(87.25);
  expect(legacy.financialSnapshot).toBeNull();
  const audit = await db.financialPolicyRevision.findUniqueOrThrow({ where: { tag_version: { tag: 'FINANCE-HISTORIC', version: 1 } } });
  expect(audit.document).toMatchObject({ owner: {}, interestFree: false, legacyAudit: { customerInterestRates: { '2': 0.123 }, absorbCustomerInterest: true } });
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const owner = await db.user.create({ data: { email: `${suffix}@finance.local`, password: 'local-test', name: 'Local' } });
  const platform = await db.platform.create({ data: { tag: `TEST-${suffix}`, name: 'Local', ownerUserId: owner.id } });
  const global = emptyPolicy();
  for (const method of METHODS) for (const channel of CHANNELS) for (let n = 1; n <= (method === 'CREDIT_CARD' ? 12 : 1); n++) global.lanes[laneKey('DOM', method, channel, n)] = {
    active: true, contract: { fixedCents: 25, ratePpm: 20_000, cashbackCents: 10, interestPpm: method === 'CREDIT_CARD' ? 40_000 : 0, base: 'BUYER_TOTAL', reference: 'Synthetic local test' },
    sim: { fixedCents: 100, ratePpm: 30_000, interestPpm: method === 'CREDIT_CARD' ? 10_000 : 0 },
  };
  const latest = await db.financialPolicyRevision.findFirst({ where: { tag: 'GLOBAL' }, orderBy: { version: 'desc' } });
  const revision = await db.financialPolicyRevision.create({ data: { tag: 'GLOBAL', version: (latest?.version ?? 0) + 1, actorId: owner.id, document: global as Prisma.InputJsonValue } });
  const user = { sub: owner.id, role: 'USER', email: owner.email } as const;
  const key = laneKey('DOM', 'CREDIT_CARD', 'ONLINE', 2);
  const client = db as never;
  const config = await getFinancialPolicy(client, platform.tag, user);
  expect(config.data).not.toHaveProperty('lanes');
  await saveFinancialPolicy(client, platform.tag, user, { version: `${revision.version}:0`, owner: { [key]: { fixedCents: 0, ratePpm: 0, passInterestPpm: 0 } } });
  const simulation = await simulateFinancialPolicy(client, platform.tag, user, { amountCents: 10001, acquirer: 'DOM', method: 'CREDIT_CARD', channel: 'ONLINE', installments: [2] });
  const context = await loadChargePolicy(db, platform.tag);
  const quote = quoteFinancialCharge(context, 100.01, 'CREDIT_CARD', 2)!;
  const { policyTag, interestOnly, ...visible } = quote.financialSnapshot;
  expect(interestOnly).toBe(true);
  expect(simulation.data[0].result).toMatchObject(visible);
  const snapshot = quote.financialSnapshot;
  const paymentId = crypto.randomUUID();
  await db.wallet.create({ data: { userId: owner.id, balance: 0 } });
  await db.$transaction(tx => persistLinkCharge(tx, { userId: owner.id, amount: new Prisma.Decimal(quote.totalAmount), netAmount: new Prisma.Decimal(quote.netAmount), financialSnapshot: snapshot,
    domPaymentId: paymentId, totalFee: new Prisma.Decimal(quote.totalFeeAmount), domFee: new Prisma.Decimal(quote.domFeeAmount), platformFee: new Prisma.Decimal(quote.platformProfit) }, 'COMPLETED'));
  const tx = await db.transaction.findUniqueOrThrow({ where: { domPaymentId: paymentId } });
  await db.$transaction(p => settleFinalNet(p, tx, 'COMPLETED', 'LOCAL_REPLAY'));
  expect((await db.wallet.findUniqueOrThrow({ where: { userId: owner.id } })).balance.toNumber()).toBe(quote.netAmount);
  expect(await db.balanceLog.count({ where: { transactionId: tx.id, action: 'LINK_SETTLEMENT_COMPLETED' } })).toBe(1);
  await saveFinancialPolicy(client, platform.tag, user, { version: context.policy.version, owner: { [key]: { fixedCents: 2000, ratePpm: 0, passInterestPpm: 1_000_000 } } });
  expect((await restoreFinancialCharge(db, snapshot))?.netAmount).toBe(quote.netAmount);
  await db.$transaction(p => settleFinalNet(p, tx, 'REFUNDED', 'LOCAL_REFUND'));
  expect((await db.wallet.findUniqueOrThrow({ where: { userId: owner.id } })).balance.toNumber()).toBe(0);
  const recurring = { snapshot, amount: new Prisma.Decimal(quote.totalAmount), paymentId: crypto.randomUUID(), userId: owner.id, method: 'CREDIT_CARD' as const, name: 'Local subscription' };
  await settleFinancialSubscription(client, recurring);
  await settleFinancialSubscription(client, recurring);
  expect((await db.wallet.findUniqueOrThrow({ where: { userId: owner.id } })).balance.toNumber()).toBe(quote.netAmount);
  const pos = quoteFinancialCharge(context, 100.01, 'CREDIT_CARD', 2, 'POS')!;
  expect(quoteReportedPos(context, pos.totalAmount, 'CREDIT_CARD', 2)?.financialSnapshot.originalCents).toBe(10001);
  expect(quoteReportedPos(await loadChargePolicy(db, platform.tag, new Date('2000-01-01')), 100, 'CREDIT_CARD', 2)).toBeNull();
}, 30000);
