import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { OwnedPlatformReportsService } from '../owned-platform-reports.service';

// Opt-in fixture uses an isolated temporary cluster, never DATABASE_URL.
const enabled = process.env.REPORTS_LOCAL_SQL_TEST === '1';
const sql = enabled ? new SQL('postgres://reports@127.0.0.1:55479/postgres', { max: 1 }) : null;
const user = { sub: 'owner', email: 'owner@test.local', role: 'USER' };
const platforms = [{ id: 'p-a', tag: 'ALPHA', name: 'Alpha', ownerUserId: 'owner', isActive: false }, { id: 'p-b', tag: 'BETA', name: 'Beta', ownerUserId: 'owner', isActive: true }];
const db: any = {
  user: { findUnique: async () => ({ id: 'owner', role: 'USER', isActive: true }) },
  platform: { findMany: async (q: any) => q.where.tag === 'EBOOK' ? [{ id: 'p-e', tag: 'EBOOK', name: 'Ebook', ownerUserId: 'owner', isActive: true }] : platforms.filter(p => !q.where.tag || p.tag === q.where.tag) },
  withdrawRequest: { count: async () => 1, findMany: async () => [] },
  $queryRaw: (query: any) => sql!.unsafe(query.text, query.values),
};
db.$transaction = async (callback: any) => callback(db);
const service = new OwnedPlatformReportsService(db);
beforeAll(async () => {
  if (!sql) return;
  await sql.unsafe(`CREATE TEMP TABLE "Platform" (id text, tag text, "ownerUserId" text, name text, "isActive" boolean DEFAULT true, acquirer text DEFAULT 'DOM');
    CREATE TEMP TABLE "User" (id text, name text, email text);
    CREATE TEMP TABLE "Transaction" (id text, "userId" text, amount numeric, "netAmount" numeric, "totalFee" numeric, status text, "paymentMethod" text, description text, "createdAt" timestamp, "paymentLinkId" text, tracking jsonb, "domPaymentId" text, "externalPaymentId" text);
    CREATE TEMP TABLE "PaymentLink" (id text, "userId" text, plataformas text[]);
    CREATE TEMP TABLE "SubscriptionLink" (id text, "userId" text, plataformas text[], "platformTag" text);
    CREATE TEMP TABLE "SubscriptionLinkOrder" (id text, "subscriptionLinkId" text, "userId" text, "createdAt" timestamp, status text, "paymentMethod" text, "amountCharged" numeric, "platformFeeAmount" numeric, "domPixPaymentId" text);
    CREATE TEMP TABLE "Community" (id text, slug text);
    CREATE TEMP TABLE "CommunityLinkBinding" ("communityId" text, "subscriptionLinkId" text);
    CREATE TEMP TABLE "IntegrationMerchant" ("userId" text, "integrationKey" text);
    CREATE TEMP TABLE "PlatformIntegration" ("platformId" text, key text, url text);`);
  await sql.unsafe(`INSERT INTO "User" VALUES ('owner','Dono','owner@test.local'), ('stranger','Outro','other@test.local');
    INSERT INTO "Platform" (id,tag,"ownerUserId",name) VALUES ('p-a','ALPHA','owner','Árvore'), ('p-b','BETA','owner','Bosque'), ('p-x','OTHER','stranger','Outro'), ('p-e','EBOOK','owner','Ebook');
    INSERT INTO "Transaction" (id,"userId",amount,"netAmount","totalFee",status,"paymentMethod",description,"createdAt") VALUES
    ('a','owner',100,90,10,'COMPLETED','PIX','[TENANT:ALPHA]','2026-10-01T03:00:00Z'),
    ('b','owner',200,180,20,'COMPLETED','CREDIT_CARD','[TENANT:BETA]','2026-10-05T03:00:00Z'),
    ('refund','owner',50,45,5,'REFUNDED','PIX','[TENANT:ALPHA]','2026-10-06T03:00:00Z'),
    ('unknown','owner',500,450,50,'COMPLETED','PIX','Sem plataforma','2026-10-06T03:00:00Z'),
    ('conflict','owner',600,540,60,'COMPLETED','PIX','[TENANT:ALPHA] [TENANT:BETA]','2026-10-06T03:00:00Z'),
    ('other','stranger',700,630,70,'COMPLETED','PIX','[TENANT:OTHER]','2026-10-06T03:00:00Z'),
    ('old-owner','previous',800,720,80,'COMPLETED','PIX','[TENANT:ALPHA]','2026-10-06T03:00:00Z'),
    ('missing','owner',10,NULL,1,'COMPLETED','PIX','[TENANT:ALPHA]','2026-10-07T03:00:00Z'),
    ('boundary','owner',900,810,90,'COMPLETED','PIX','[TENANT:ALPHA]','2026-11-01T03:00:00Z'),
    ('ebook','owner',17,15,2,'COMPLETED','PIX','[TENANT:EBOOKSIM] [TENANT:EBOOK]','2026-11-01T02:59:59Z');`);
});
afterAll(async () => { if (sql) await sql.close(); });
const local = enabled ? test : test.skip;
const filters = { startDate: '2026-10-01', endDate: '2026-10-31' };
local('real PostgreSQL: exact attribution, inactive history, no previous owners and no internal fields', async () => {
  const all = await service.summary(user, filters);
  expect(all).toMatchObject({ platformsCount: 2, summary: { salesCount: 3, grossCents: 31000, netCents: 27000, feesCents: 3100, refundsCents: 4500, missingNetSnapshots: 1, unattributedEntries: 3, historicalAttributionComplete: false } });
  expect(JSON.stringify(all)).not.toMatch(/domFee|platformFee|lucro|customer|Wallet/);
  const alpha = await service.summary(user, { ...filters, platform: 'ALPHA', paymentMethod: 'PIX' });
  expect(alpha.summary).toMatchObject({ salesCount: 2, grossCents: 11000, netCents: 9000 });
});
local('real PostgreSQL: status, methods and monthly totals share exact scope', async () => {
  expect((await service.series(user, filters, 'monthly')).data).toEqual([{ key: '2026-10', count: 3, grossCents: 31000, netCents: 27000 }]);
  expect((await service.series(user, { ...filters, platform: 'BETA' }, 'method')).data).toEqual([{ key: 'CREDIT_CARD', count: 1, grossCents: 20000, netCents: 18000 }]);
  expect((await service.series(user, filters, 'status')).data.map(r => [r.key, r.count])).toEqual([['COMPLETED', 3], ['REFUNDED', 1]]);
});
local('real PostgreSQL: paginated transactions contain only authorized rows and null net is explicit', async () => {
  const first = await service.transactionDetails(user, { ...filters, pageSize: '2' });
  const second = await service.transactionDetails(user, { ...filters, pageSize: '2', page: '2' });
  expect(first.total).toBe(4); expect(second.total).toBe(4);
  expect([...first.data, ...second.data].map(r => r.id)).toEqual(['missing','refund','b','a']);
  expect(first.data[0].netCents).toBeNull();
  expect(new Set([...first.data, ...second.data].map(r => r.id)).size).toBe(4);
});

local('real PostgreSQL: catalog searches accents, orders by name and pages within owner scope', async () => {
  const first = await service.catalog(user, { pageSize: '1' });
  const second = await service.catalog(user, { pageSize: '1', page: '2' });
  expect(first.data.map(p => p.name)).toEqual(['Árvore']);
  expect(second.data.map(p => p.name)).toEqual(['Bosque']);
  expect(first.total).toBe(3);
  const searched = await service.catalog(user, { search: 'arvore' });
  expect(searched.data.map(p => p.tag)).toEqual(['ALPHA']);
  expect(Object.keys(searched.data[0]).sort()).toEqual(['id','isActive','name','tag']);
});

local('real PostgreSQL: legacy equivalent tags count once and local monthly boundary follows Sao Paulo', async () => {
  const filters = { platform: 'EBOOK', startDate: '2026-10-31', endDate: '2026-10-31' };
  expect((await service.summary(user, filters)).summary).toMatchObject({ salesCount: 1, grossCents: 1700, netCents: 1500 });
  expect((await service.series(user, filters, 'monthly')).data).toEqual([{ key: '2026-10', count: 1, grossCents: 1700, netCents: 1500 }]);
});

local('real PostgreSQL: linked legacy sales, merchant owner snapshots and paid orders reconcile everywhere', async () => {
  await sql!.unsafe(`INSERT INTO "PaymentLink" VALUES ('legacy-link','owner',ARRAY['ALPHA']),('ambiguous','owner',ARRAY['ALPHA','BETA']);
    INSERT INTO "SubscriptionLink" VALUES ('sub','owner',ARRAY[]::text[],NULL);
    INSERT INTO "Community" VALUES ('community-alpha','alpha');
    INSERT INTO "CommunityLinkBinding" VALUES ('community-alpha','sub');
    INSERT INTO "SubscriptionLinkOrder" VALUES
      ('order-only','sub','owner','2026-10-12T12:00:00Z','paid','PIX',30,3,NULL),
      ('order-duplicate','sub','owner','2026-10-12T12:00:00Z','paid','PIX',40,4,'provider-ref'),
      ('order-refunded','sub','owner','2026-10-12T12:00:00Z','paid','PIX',50,5,'refunded-ref'),
      ('foreign-order','sub','previous','2026-10-12T12:00:00Z','paid','PIX',800,80,NULL);
    INSERT INTO "Transaction" (id,"userId",amount,"netAmount","totalFee",status,"paymentMethod",description,"createdAt","paymentLinkId",tracking,"domPaymentId") VALUES
      ('linked','owner',60,54,0,'COMPLETED','PIX','Legacy','2026-10-12T12:00:00Z','legacy-link',NULL,NULL),
      ('ambiguous-link','owner',900,810,90,'COMPLETED','PIX','Legacy','2026-10-12T12:00:00Z','ambiguous',NULL,NULL),
      ('merchant','seller',70,63,0,'COMPLETED','PIX','[TENANT:ALPHA]','2026-10-12T12:00:00Z',NULL,'{"reportAttribution":{"platformId":"p-a","ownerUserId":"owner","beneficiaryUserId":"seller"}}',NULL),
      ('previous-merchant','seller',700,630,70,'COMPLETED','PIX','[TENANT:ALPHA]','2026-10-12T12:00:00Z',NULL,'{"reportAttribution":{"platformId":"p-a","ownerUserId":"previous","beneficiaryUserId":"seller"}}',NULL),
      ('real-order','owner',40,36,0,'COMPLETED','PIX','subOrder=order-duplicate','2026-10-12T12:00:00Z',NULL,NULL,'provider-ref'),
      ('refunded-order','owner',50,45,0,'REFUNDED','PIX','[TENANT:ALPHA] subOrder=order-refunded','2026-10-12T12:00:00Z',NULL,NULL,'refunded-ref');`);
  try {
    const selected = { platform: 'ALPHA', startDate: '2026-10-12', endDate: '2026-10-12', paymentMethod: 'PIX' };
    const summary = await service.summary(user, selected);
    expect(summary.summary).toMatchObject({ salesCount: 4, grossCents: 20000, netCents: 18000, feesCents: 2000, refundsCents: 4500, historicalAttributionComplete: false });
    const details = await service.transactionDetails(user, selected);
    expect(details.total).toBe(5);
    expect(details.data.map(row => row.id).sort()).toEqual(['comunidade_order_order-only','linked','merchant','real-order','refunded-order']);
    expect(details.data.filter(row => row.status === 'COMPLETED').reduce((sum, row) => sum + row.feesCents, 0)).toBe(summary.summary.feesCents);
    expect((await service.series(user, selected, 'monthly')).data).toEqual([{ key: '2026-10', count: 4, grossCents: 20000, netCents: 18000 }]);
    expect((await service.series(user, selected, 'method')).data).toEqual([{ key: 'PIX', count: 4, grossCents: 20000, netCents: 18000 }]);
    expect((await service.summary(user, { ...selected, paymentMethod: 'CREDIT_CARD' })).summary.salesCount).toBe(0);
    expect((await service.transactionDetails(user, { ...selected, pageSize: '2', page: '2' })).data).toHaveLength(2);
  } finally {
    await sql!.unsafe(`DELETE FROM "Transaction" WHERE "createdAt" = '2026-10-12T12:00:00Z'; DELETE FROM "SubscriptionLinkOrder"; DELETE FROM "SubscriptionLink"; DELETE FROM "PaymentLink"; DELETE FROM "CommunityLinkBinding"; DELETE FROM "Community";`);
  }
});

local('real PostgreSQL: unknown tags and unbound merchant history report incomplete attribution', async () => {
  await sql!.unsafe(`INSERT INTO "IntegrationMerchant" VALUES ('seller','platform:p-a');
    INSERT INTO "Transaction" (id,"userId",amount,"netAmount","totalFee",status,"paymentMethod",description,"createdAt") VALUES
      ('unknown-tag','owner',90,81,9,'COMPLETED','PIX','[TENANT:UNKNOWN]','2026-10-13T12:00:00Z'),
      ('unbound-merchant','seller',100,90,10,'COMPLETED','PIX','[TENANT:ALPHA]','2026-10-13T12:00:00Z');`);
  try {
    const result = await service.summary(user, { platform: 'ALPHA', startDate: '2026-10-13', endDate: '2026-10-13' });
    expect(result.summary).toMatchObject({ salesCount: 0, unattributedEntries: 3, historicalAttributionComplete: false });
  } finally {
    await sql!.unsafe(`DELETE FROM "IntegrationMerchant"; DELETE FROM "Transaction" WHERE "createdAt" = '2026-10-13T12:00:00Z';`);
  }
});
