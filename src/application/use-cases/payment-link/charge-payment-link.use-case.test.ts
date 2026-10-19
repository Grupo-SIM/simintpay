import { afterEach, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { ChargePaymentLinkUseCase } from './charge-payment-link.use-case';
import { bindLinkPayment, linkChargeReference, settleFinalNet } from '../../../modules/platform-core/link-settlement';
const oldToken = process.env.DOM_TOKEN;
afterEach(() => { if (oldToken === undefined) delete process.env.DOM_TOKEN; else process.env.DOM_TOKEN = oldToken; });
function fixture(early = false, fail = false, financial = false) {
  process.env.DOM_TOKEN = 'test-token';
  let row: any, wallet: any = { id: 'wallet', userId: 'owner', balance: new Prisma.Decimal(0), lockedBalance: new Prisma.Decimal(0), version: 0 };
  let logs: any[] = [];
  const p: any = {
    user: { findUnique: async () => null },
    affiliateCommission: { findUnique: async () => null },
    transaction: {
      create: async ({ data }: any) => (row = { ...data, domPaymentId: null }),
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }: any) => {
        if (where.status && row.status !== where.status) return { count: 0 };
        if (where.domPaymentId === null && row.domPaymentId !== null) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
    },
    wallet: { upsert: async () => wallet, findUnique: async () => ({ ...wallet }), updateMany: async ({ data }: any) => { Object.assign(wallet, data, { version: wallet.version + 1 }); return { count: 1 }; } },
    balanceLog: { findFirst: async () => logs[0], create: async ({ data }: any) => { if (fail) throw new Error('audit failure'); logs.push(data); } },
    transactionStatusHistory: { create: async () => {} },
  };
  const lane = { active: true, contract: { reference: 'Signed', fixedCents: 100, ratePpm: 20000, cashbackCents: 15, interestPpm: 40000, base: 'ORIGINAL' }, sim: { fixedCents: 200, ratePpm: 30000, interestPpm: 10000 } };
  const document = { schemaVersion: 1, lanes: { 'DOM/CREDIT_CARD/ONLINE/1': lane }, owner: {}, interestFree: false };
  const prisma: any = { financialPolicyRevision: { findMany: async () => financial ? [{ tag: 'GLOBAL', version: 1, document }] : [] }, platform: { findUnique: async () => null }, user: { findUnique: async () => ({ email: 'owner@example.test' }) }, $transaction: async (fn: any) => {
    const beforeRow = row && { ...row }, beforeWallet = { ...wallet }, beforeLogs = [...logs];
    try { return await fn(p); } catch (e) { row = beforeRow; wallet = beforeWallet; logs = beforeLogs; throw e; }
  } };
  const link: any = { id: 'link', userId: 'owner', isActive: true, domPaymentLinkId: 'dom-link', amount: 100, title: 'Plan', isStandalone: true, plataformas: ['GLOBAL'] };
  const gateway: any = { chargePaymentLink: async (_: string, input: any) => {
    expect(row.status).toBe('DRAFT'); expect(row.netAmount.toNumber()).toBe(financial ? 86.85 : 87);
    if (financial) { expect(input.amount).toBe(100); lane.sim.fixedCents = 5000; }
    expect(linkChargeReference(input.description)).toBe(row.id);
    if (early) await prisma.$transaction(async (tx: any) => {
      const snapshot = { ...row };
      await bindLinkPayment(tx, snapshot, 'payment');
      await settleFinalNet(tx, snapshot, 'COMPLETED', 'EARLY_WEBHOOK');
    });
    return { id: 'payment', status: early ? 'pending' : 'approved' };
  } };
  const service = new ChargePaymentLinkUseCase({ findById: async () => link, update: async () => link } as never,
    { findById: async () => ({ id: 'owner', platform: null }) } as never, gateway, prisma);
  const input: any = { linkId: 'link', customerName: 'Buyer', customerEmail: 'buyer@example.test', customerDocument: '12345678901', customerPhone: '81999999999', paymentMethod: 'credit_card', installments: 1, card: { token: 'fake' } };
  return { service, input, row: () => row, wallet: () => wallet, logs: () => logs };
}
test('approved charge creates final snapshot before gateway and commits credit atomically', async () => {
  const f = fixture(); await f.service.execute(f.input);
  expect(f.row().status).toBe('COMPLETED'); expect(f.wallet().balance.toNumber()).toBe(87); expect(f.logs()).toHaveLength(1);
});
test('webhook before gateway response fixes snapshot; pending response cannot regress or double credit', async () => {
  const f = fixture(true); await f.service.execute(f.input);
  expect(f.row().status).toBe('COMPLETED'); expect(f.wallet().balance.toNumber()).toBe(87); expect(f.logs()).toHaveLength(1);
});
test('failed credit leaves draft and no approved ledger row', async () => {
  const f = fixture(false, true);
  await expect(f.service.execute(f.input)).rejects.toThrow('audit failure');
  expect(f.row().status).toBe('DRAFT'); expect(f.wallet().balance.toNumber()).toBe(0); expect(f.logs()).toHaveLength(0);
});

test('new financial policy charges the simulated total and settles its immutable net exactly once', async () => {
  for (const early of [false, true]) {
    const f = fixture(early, false, true); await f.service.execute(f.input);
    expect(f.row().financialSnapshot.originalCents).toBe(10000);
    expect(f.row().financialSnapshot).not.toHaveProperty('acquirerCostCents');
    expect(f.wallet().balance.toNumber()).toBe(86.85);
    expect(f.logs()).toHaveLength(1);
  }
});
