import { afterAll, expect, test } from 'bun:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CoproductionService, captureCoproduction, withCoproduction, createWithCoproduction } from '../coproduction.service';
import { settleFinalNet, persistLinkCharge } from '../../platform-core/link-settlement';
import { settleFinancialSubscription } from '../../financial-policy/financial-subscription';
import type { Product } from '../coproduction';

const url = process.env.COPRODUCTION_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('Tests require a local isolated database');
const db = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;
afterAll(async () => { await db?.$disconnect(); });
const run = (name: string, body: () => Promise<void>) => test.skipIf(!db)(name, body, 30000);
async function fixture() {
  const prisma = db!;
  const user = (role: 'ADMIN' | 'USER' = 'USER', clientStatus: 'APPROVED' | 'PENDING' = 'APPROVED') => prisma.user.create({ data: { email: `${crypto.randomUUID()}@local.test`, name: 'Local', password: 'test', role, clientStatus } });
  const [owner, partner, outsider, pending, admin] = await Promise.all([user(), user(), user(), user('USER', 'PENDING'), user('ADMIN')]);
  const product = await prisma.paymentLink.create({ data: { userId: owner.id, title: 'Local sale', amount: 100 } });
  const service = new CoproductionService(prisma as never);
  return { prisma, owner, partner, outsider, pending, admin, product, service };
}
run('all five product endpoints authorize owners/admin and reject pending accounts/foreign products', async () => {
  const f = await fixture();
  const factories: [Product, () => Promise<{ id: string }>][] = [
    ['links-pagamento', async () => f.product],
    ['links-assinatura', () => db!.subscriptionLink.create({ data: { userId: f.owner.id, name: 'Local', amount: 100, frequencyType: 'MONTHLY' } })],
    ['boletos', () => db!.boleto.create({ data: { userId: f.owner.id, title: 'Local', amount: 100 } })],
    ['planos', () => db!.plan.create({ data: { userId: f.owner.id, name: 'Local', price: 100, type: 'MONTHLY' } })],
    ['planos-pix', () => db!.pixCreditPlan.create({ data: { userId: f.owner.id, price: 100, type: 'MONTHLY' } })],
  ];
  for (const [kind, create] of factories) {
    const p = await create();
    expect((await f.service.get(f.owner.id, kind, p.id)).data).toMatchObject({ basis: 'NET', mode: 'INHERIT', version: 0, participants: [] });
    await expect(f.service.get(f.outsider.id, kind, p.id)).rejects.toThrow('restrita');
    await expect(f.service.get(f.pending.id, kind, p.id)).rejects.toThrow('restrita');
    const body = { basis: 'NET', version: 0, participants: [{ email: f.partner.email.toUpperCase(), percentageBps: 2550 }] };
    expect((await f.service.save(f.admin.id, kind, p.id, body)).data.version).toBe(1);
    expect((await f.service.get(f.owner.id, kind, p.id)).data.participants[0].email).toBe(f.partner.email);
    await expect(f.service.save(f.owner.id, kind, p.id, body)).rejects.toThrow('outra sessão');
  }
  await expect(f.service.get(f.owner.id, 'constructor', f.product.id)).rejects.toThrow('Tipo');
  await expect(f.service.get(f.owner.id, 'planos', 'missing')).rejects.toThrow('não encontrado');
  for (const email of [f.owner.email, f.pending.email, f.admin.email, 'missing@local.test']) await expect(f.service.save(f.owner.id, 'links-pagamento', f.product.id, { basis: 'NET', version: 1, participants: [{ email, percentageBps: 1 }] })).rejects.toThrow();
});
run('concurrent config saves: one revision wins, no lost updates', async () => {
  const f = await fixture();
  const body = { basis: 'NET', version: 0, participants: [{ email: f.partner.email, percentageBps: 3333 }] };
  const results = await Promise.allSettled([f.service.save(f.owner.id, 'links-pagamento', f.product.id, body), f.service.save(f.owner.id, 'links-pagamento', f.product.id, body)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
});
run('real settlement races, immutable shares, mediation, release, refund and private receipts', async () => {
  const f = await fixture();
  await f.service.save(f.owner.id, 'links-pagamento', f.product.id, { basis: 'NET', version: 0, participants: [{ email: f.partner.email, percentageBps: 3333 }] });
  const agreement = await captureCoproduction(db!, 'links-pagamento', f.product.id, f.owner.id);
  const row = await db!.transaction.create({ data: { userId: f.owner.id, amount: 12, netAmount: 10.01, status: 'PENDING', settlementBasis: 'FINAL_NET', financialSnapshot: withCoproduction(undefined, agreement) } });
  const pay = () => db!.$transaction(tx => settleFinalNet(tx, row, 'COMPLETED', 'LOCAL_TEST'));
  const results = await Promise.all([pay(), pay(), pay()]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const balance = async (id: string) => (await db!.wallet.findUniqueOrThrow({ where: { userId: id } })).balance.toFixed(2);
  expect(await balance(f.partner.id)).toBe('3.33'); expect(await balance(f.owner.id)).toBe('6.68');
  expect(await db!.balanceLog.count({ where: { transactionId: row.id } })).toBe(2);
  await f.service.save(f.owner.id, 'links-pagamento', f.product.id, { basis: 'NET', version: 1, participants: [] });
  const transition = async (status: 'IN_MEDIATION' | 'COMPLETED' | 'REFUNDED') => db!.$transaction(async tx => settleFinalNet(tx, await tx.transaction.findUniqueOrThrow({ where: { id: row.id } }), status, 'LOCAL_TEST'));
  await transition('IN_MEDIATION');
  const mediatedWallet = await db!.wallet.findUniqueOrThrow({ where: { userId: f.partner.id } });
  expect(mediatedWallet.balance.toFixed(2)).toBe('3.33');
  expect(mediatedWallet.lockedBalance.toFixed(2)).toBe('3.33');
  expect(mediatedWallet.balance.sub(mediatedWallet.lockedBalance).toFixed(2)).toBe('0.00');
  await transition('COMPLETED'); expect(await balance(f.partner.id)).toBe('3.33');
  const receipts = await f.service.receipts(f.partner.id);
  expect(receipts.summary.creditedCents).toBe(333); expect(receipts.data[0]).not.toHaveProperty('customerEmail');
  expect((await f.service.receipts(f.outsider.id)).total).toBe(0);
  await transition('REFUNDED'); expect(await balance(f.partner.id)).toBe('0.00'); expect(await balance(f.owner.id)).toBe('0.00');
  expect((await f.service.receipts(f.partner.id)).summary.reversedCents).toBe(333);
});
run('wallet, audit, allocation and status rollback together on failures; renewal keeps initial split', async () => {
  const f = await fixture();
  await f.service.save(f.owner.id, 'links-pagamento', f.product.id, { basis: 'NET', version: 0, participants: [{ email: f.partner.email, percentageBps: 10000 }] });
  const agreement = await captureCoproduction(db!, 'links-pagamento', f.product.id, f.owner.id);
  const snapshot = withCoproduction(undefined, agreement, { totalAmount: 100, netAmount: 90, totalFeeAmount: 10, domFeeAmount: 3, platformProfit: 7, policyTag: 'GLOBAL' });
  const row = await db!.transaction.create({ data: { userId: f.owner.id, amount: 100, netAmount: 90, status: 'PENDING', settlementBasis: 'FINAL_NET', financialSnapshot: snapshot } });
  await expect(db!.$transaction(async tx => { await settleFinalNet(tx, row, 'COMPLETED', 'LOCAL_TEST'); throw new Error('late audit failure'); })).rejects.toThrow('late audit');
  expect((await db!.transaction.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
  expect(await db!.balanceLog.count({ where: { transactionId: row.id } })).toBe(0);
  const allocations = await db!.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM "CoproductionAllocation" WHERE "transactionId" = ${row.id}`;
  expect(Number(allocations[0].count)).toBe(0);
  await f.service.save(f.owner.id, 'links-pagamento', f.product.id, { basis: 'NET', version: 1, participants: [] });
  const recurring = { snapshot: snapshot as Prisma.JsonValue, amount: new Prisma.Decimal(100), userId: f.owner.id, method: 'CREDIT_CARD' as const, name: 'Renewal', paymentId: crypto.randomUUID() };
  await settleFinancialSubscription(db! as never, recurring); await settleFinancialSubscription(db! as never, recurring);
  expect((await db!.wallet.findUniqueOrThrow({ where: { userId: f.partner.id } })).balance.toFixed(2)).toBe('90.00');
  expect((await db!.wallet.findUniqueOrThrow({ where: { userId: f.owner.id } })).balance.toFixed(2)).toBe('0.00');
  await settleFinancialSubscription(db! as never, { ...recurring, paymentId: crypto.randomUUID() });
  expect((await db!.wallet.findUniqueOrThrow({ where: { userId: f.partner.id } })).balance.toFixed(2)).toBe('180.00');
  const charged = await db!.transaction.findUniqueOrThrow({ where: { domPaymentId: recurring.paymentId } });
  await db!.$transaction(tx => settleFinalNet(tx, charged, 'IN_MEDIATION', 'LOCAL_TEST'));
  const locked = await db!.transaction.findUniqueOrThrow({ where: { id: charged.id } });
  await db!.$transaction(tx => settleFinalNet(tx, locked, 'CHARGEBACK', 'LOCAL_TEST'));
  expect((await db!.wallet.findUniqueOrThrow({ where: { userId: f.partner.id } })).lockedBalance.toFixed(2)).toBe('0.00');
});
run('historical sale without snapshot never gets retroactive allocation', async () => {
  const f = await fixture();
  await db!.wallet.create({ data: { userId: f.owner.id, balance: 0 } });
  await db!.$transaction(tx => persistLinkCharge(tx, { userId: f.owner.id, amount: 100, netAmount: 90, domPaymentId: crypto.randomUUID() }, 'COMPLETED'));
  expect((await db!.wallet.findUniqueOrThrow({ where: { userId: f.owner.id } })).balance.toFixed(2)).toBe('90.00');
  expect((await f.service.receipts(f.partner.id)).total).toBe(0);
});
run('owner reports and attributed balances exclude partner share while preserving actual fees', async () => {
  const { OwnedPlatformReportsService } = await import('../../../application/services/owned-platform-reports.service');
  const { PlatformAttributedBalance } = await import('../../platform-core/platform-attributed-balance');
  const f = await fixture();
  const tag = `COPROD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const platform = await db!.platform.create({ data: { ownerUserId: f.owner.id, name: 'Local coproduction', tag } });
  await f.service.save(f.owner.id, 'links-pagamento', f.product.id, { basis: 'NET', version: 0, participants: [{ email: f.partner.email, percentageBps: 3333 }] });
  const agreement = await captureCoproduction(db!, 'links-pagamento', f.product.id, f.owner.id);
  await db!.$transaction(tx => persistLinkCharge(tx, { userId: f.owner.id, amount: 12, netAmount: 10.01, totalFee: 1.99, description: `[TENANT:${tag}]`, domPaymentId: crypto.randomUUID(), financialSnapshot: withCoproduction(undefined, agreement) }, 'COMPLETED'));
  const actor = { sub: f.owner.id, role: 'USER', email: f.owner.email };
  const report = await new OwnedPlatformReportsService(db! as never).summary(actor, { platform: tag });
  expect(report.summary).toMatchObject({ grossCents: 1200, netCents: 668, feesCents: 199 });
  const balance = await new PlatformAttributedBalance(db! as never).read({ id: platform.id, tag, ownerUserId: f.owner.id } as never);
  expect(balance.earnedCents).toBe(668);
});

run('create product and several shares atomically; approve and notify each private net amount once', async () => {
  const f = await fixture();
  const config = { basis: 'NET', version: 0, participants: [{ email: f.partner.email, percentageBps: 3000 }, { email: f.outsider.email, percentageBps: 2000 }] };
  const products = [
    ['links-pagamento', (tx: Prisma.TransactionClient) => tx.paymentLink.create({ data: { userId: f.owner.id, title: 'Initial agreement', amount: 100 } })],
    ['links-assinatura', (tx: Prisma.TransactionClient) => tx.subscriptionLink.create({ data: { userId: f.owner.id, name: 'Initial agreement', amount: 100, frequencyType: 'MONTHLY' } })],
    ['boletos', (tx: Prisma.TransactionClient) => tx.boleto.create({ data: { userId: f.owner.id, title: 'Initial agreement', amount: 100 } })],
    ['planos', (tx: Prisma.TransactionClient) => tx.plan.create({ data: { userId: f.owner.id, name: 'Initial agreement', price: 100, type: 'MONTHLY' } })],
    ['planos-pix', (tx: Prisma.TransactionClient) => tx.pixCreditPlan.create({ data: { userId: f.owner.id, price: 100, type: 'MONTHLY' } })],
  ] as const;
  for (const [kind, create] of products) {
    const saved = await createWithCoproduction(db! as never, kind, f.owner.id, config, create as (tx: Prisma.TransactionClient) => Promise<{ id: string }>);
    expect((await f.service.get(f.owner.id, kind, saved.id)).data).toMatchObject({ version: 1, participants: config.participants });
    const agreement = await captureCoproduction(db!, kind, saved.id, f.owner.id);
    for (const userId of [f.owner.id, f.partner.id, f.outsider.id]) await db!.$executeRaw`INSERT INTO "PushSubscription" (id,"userId",endpoint,p256dh,auth) VALUES (${crypto.randomUUID()},${userId},${'https://local.test/'+crypto.randomUUID()},'test','test')`;
    const row = await db!.transaction.create({ data: { userId: f.owner.id, amount: 100, netAmount: 90.01, status: 'PENDING', settlementBasis: 'FINAL_NET', financialSnapshot: withCoproduction(undefined, agreement) } });
    expect(await db!.salePushEvent.count({ where: { transactionId: row.id } })).toBe(0);
    const approve = () => db!.$transaction(tx => settleFinalNet(tx, row, 'COMPLETED', 'LOCAL_PUSH_TEST'));
    await Promise.all([approve(), approve()]);
    const events = await db!.salePushEvent.findMany({ where: { transactionId: row.id } });
    expect(events).toHaveLength(3);
    expect(events.find(e => e.userId === f.owner.id)?.amount.toFixed(2)).toBe('45.01');
    expect(events.find(e => e.userId === f.partner.id)?.amount.toFixed(2)).toBe('27.00');
    expect(events.find(e => e.userId === f.outsider.id)?.amount.toFixed(2)).toBe('18.00');
    const deliveries = await db!.pushDelivery.findMany({ where: { eventId: { in: events.map(e => e.id) } }, include: { subscription: true, event: true } });
    expect(deliveries.every(d => d.subscription.userId === d.event.userId)).toBe(true);
    const current = await db!.transaction.findUniqueOrThrow({ where: { id: row.id } });
    await db!.$transaction(tx => settleFinalNet(tx, current, 'IN_MEDIATION', 'LOCAL_PUSH_TEST'));
    const mediated = await db!.transaction.findUniqueOrThrow({ where: { id: row.id } });
    await db!.$transaction(tx => settleFinalNet(tx, mediated, 'COMPLETED', 'LOCAL_PUSH_TEST'));
    expect(await db!.salePushEvent.count({ where: { transactionId: row.id } })).toBe(3);
  }
  const title = crypto.randomUUID();
  await expect(createWithCoproduction(db! as never, 'links-pagamento', f.owner.id, config, async tx => {
    await tx.paymentLink.create({ data: { userId: f.owner.id, title, amount: 100 } });
    throw new Error('create rollback');
  })).rejects.toThrow('create rollback');
  expect(await db!.paymentLink.count({ where: { title } })).toBe(0);
  await expect(createWithCoproduction(db! as never, 'links-pagamento', f.owner.id, { ...config, participants: [{ email: f.pending.email, percentageBps: 1000 }] }, async () => { throw new Error('must not create'); })).rejects.toThrow('ativa e aprovada');
});

run('account search matches name OR email, paginates and exposes only eligible public identities', async () => {
  const f = await fixture();
  const tag = crypto.randomUUID().replaceAll('-', '');
  const first = await db!.user.update({ where: { id: f.partner.id }, data: { name: `${tag} Ana`, email: `mail-${tag}@local.test` } });
  const second = await db!.user.update({ where: { id: f.outsider.id }, data: { name: 'Outra Pessoa', email: `${tag}@local.test` } });
  for (const id of [f.owner.id, f.pending.id, f.admin.id]) await db!.user.update({ where: { id }, data: { name: tag } });
  const inactive = await db!.user.create({ data: { name: tag, email: `${crypto.randomUUID()}@local.test`, password: 'private', clientStatus: 'APPROVED', isActive: false } });
  const purged = await db!.user.create({ data: { name: tag, email: `${crypto.randomUUID()}@local.test`, password: 'private', clientStatus: 'APPROVED', isPurged: true } });
  const result = await f.service.accounts(f.owner.id, tag.toUpperCase());
  expect(result.total).toBe(2);
  expect(result.data.map(u => u.id).sort()).toEqual([first.id, second.id].sort());
  expect(result.data.every(u => Object.keys(u).sort().join(',') === 'email,id,name')).toBe(true);
  expect((await f.service.accounts(f.owner.id, '')).data.length).toBeGreaterThan(0);
  expect((await f.service.accounts(f.owner.id, '%_')).total).toBe(0);
  for (const id of [f.pending.id, inactive.id, purged.id]) await expect(f.service.accounts(id, tag)).rejects.toThrow('aprovada');
  for (const page of ['0', '-1', '1.2', '1000001']) await expect(Promise.resolve().then(() => f.service.accounts(f.owner.id, tag, page))).rejects.toThrow('inválida');
  for (let i = 0; i < 21; i++) await db!.user.create({ data: { name: `${tag} List ${String(i).padStart(2, '0')}`, email: `${crypto.randomUUID()}@local.test`, password: 'private', clientStatus: 'APPROVED' } });
  const page1 = await f.service.accounts(f.owner.id, `${tag} List`);
  const page2 = await f.service.accounts(f.owner.id, `${tag} List`, '2');
  expect(page1.data).toHaveLength(20); expect(page2.data).toHaveLength(1); expect(page2.total).toBe(21);
  expect(page1.data.some(u => u.id === page2.data[0].id)).toBe(false);
  await f.service.save(f.owner.id, 'links-pagamento', f.product.id, { basis: 'NET', version: 0, participants: [{ email: first.email, percentageBps: 1000 }] });
  expect((await f.service.get(f.owner.id, 'links-pagamento', f.product.id)).data.participants[0].name).toBe(first.name);
});
run('platform defaults across all five products, explicit empty OWN and versioned return to INHERIT', async () => {
 const f = await fixture(); const tag = `LOCAL-${crypto.randomUUID()}`.toUpperCase();
 const platform = await db!.platform.create({ data: { tag, name: 'Local platform', ownerUserId: f.owner.id } });
 await f.service.save(f.owner.id, 'plataformas', platform.id, { basis: 'NET', version: 0, participants: [{ email: f.partner.email, percentageBps: 500 }] });
 const products: [Product, { id: string }][] = [
  ['links-pagamento', await db!.paymentLink.update({ where: { id: f.product.id }, data: { plataformas: [tag] } })],
  ['links-assinatura', await db!.subscriptionLink.create({ data: { userId: f.owner.id, name: 'Local', amount: 100, frequencyType: 'MONTHLY', plataformas: [tag] } })],
  ['boletos', await db!.boleto.create({ data: { userId: f.owner.id, title: 'Local', amount: 100, plataformas: [tag] } })],
  ['planos', await db!.plan.create({ data: { userId: f.owner.id, name: 'Local', price: 100, type: 'MONTHLY', plataformas: [tag] } })],
  ['planos-pix', await db!.pixCreditPlan.create({ data: { userId: f.owner.id, price: 100, type: 'MONTHLY', tenantTag: tag } })],
 ];
 for (const [kind, p] of products) {
  expect((await captureCoproduction(db!, kind, p.id, f.owner.id, tag))?.participants[0]).toEqual({ userId: f.partner.id, percentageBps: 500 });
  await f.service.save(f.owner.id, kind, p.id, { basis: 'NET', version: 0, participants: [] });
  expect(await captureCoproduction(db!, kind, p.id, f.owner.id, tag)).toBeNull();
  await f.service.save(f.owner.id, kind, p.id, { basis: 'NET', mode: 'INHERIT', version: 1, participants: [] });
  const result = await f.service.get(f.owner.id, kind, p.id);
  expect(result.data.mode).toBe('INHERIT'); expect(result.data.effective?.source?.platformId).toBe(platform.id);
 }
 await expect(f.service.save(f.outsider.id, 'plataformas', platform.id, { basis: 'NET', version: 1, participants: [] })).rejects.toThrow('restrita');
 await expect(f.service.save(f.owner.id, 'plataformas', platform.id, { basis: 'NET', mode: 'INHERIT', version: 1, participants: [] })).rejects.toThrow('não herda');
});
run('Delivery item split credits exact wallets, ignores config changes and reverses original allocations', async () => {
 const f = await fixture(); const platform = await db!.platform.create({ data: { tag: `LOCAL-${crypto.randomUUID()}`, name: 'Local delivery', ownerUserId: f.owner.id } });
 await f.service.save(f.owner.id, 'plataformas', platform.id, { basis: 'NET', version: 0, participants: [{ email: f.partner.email, percentageBps: 500 }] });
 const agreement = (await captureCoproduction(db!, 'plataformas', platform.id, f.owner.id))!;
 agreement.baseCents = 10000;
 const balance = async (userId: string) => (await db!.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(2);
 const row = await db!.transaction.create({ data: { userId: f.owner.id, amount: 115.37, netAmount: 110, totalFee: 5.37, platformFee: 5.37, status: 'PENDING', settlementBasis: 'FINAL_NET', financialSnapshot: withCoproduction({ contract: 'SIM_DELIVERY_ALLOCATION_V1', itemsAmountCents: 10000, deliveryAmountCents: 1000 }, agreement) } });
 await f.service.save(f.owner.id, 'plataformas', platform.id, { basis: 'NET', version: 1, participants: [] });
 const transition = (status: 'COMPLETED' | 'IN_MEDIATION' | 'CHARGEBACK') => db!.$transaction(async tx => settleFinalNet(tx, await tx.transaction.findUniqueOrThrow({ where: { id: row.id } }), status, 'LOCAL_TEST'));
 await transition('COMPLETED'); await transition('COMPLETED');
 expect(await balance(f.partner.id)).toBe('5.00'); expect(await balance(f.owner.id)).toBe('105.00');
 await transition('IN_MEDIATION'); expect((await db!.wallet.findUniqueOrThrow({ where: { userId: f.partner.id } })).lockedBalance.toFixed(2)).toBe('5.00');
 await transition('COMPLETED'); expect(await balance(f.owner.id)).toBe('105.00');
 await transition('CHARGEBACK'); expect(await balance(f.partner.id)).toBe('0.00'); expect(await balance(f.owner.id)).toBe('0.00');
 expect((await f.service.receipts(f.partner.id)).summary.reversedCents).toBe(500);
});
run('platform defaults remain isolated and shared historical Delivery binding blocks enablement', async () => {
 const f = await fixture();
 const a = await db!.platform.create({ data: { tag: `LOCAL-${crypto.randomUUID()}`.toUpperCase(), name: 'A', ownerUserId: f.owner.id } });
 const b = await db!.platform.create({ data: { tag: `LOCAL-${crypto.randomUUID()}`.toUpperCase(), name: 'B', ownerUserId: f.owner.id } });
 const body = { basis: 'NET', version: 0, participants: [{ email: f.partner.email, percentageBps: 500 }] };
 await f.service.save(f.owner.id, 'plataformas', a.id, body);
 expect(await captureCoproduction(db!, 'plataformas', b.id, f.owner.id)).toBeNull();
 for (let i = 0; i < 2; i++) await db!.deliveryPlatformRegistration.create({ data: { integrationKey: `sim-delivery_local-${crypto.randomUUID()}`, externalMerchantId: crypto.randomUUID(), name: 'Local', platformId: b.id } });
 await expect(f.service.save(f.owner.id, 'plataformas', b.id, body)).rejects.toThrow('compartilhada');
 expect(await captureCoproduction(db!, 'plataformas', b.id, f.owner.id)).toBeNull();
});
