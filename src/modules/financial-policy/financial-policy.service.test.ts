import { describe, expect, mock, test } from 'bun:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { quoteFinancialCharge } from './financial-charge';
import { loadFinancialPolicy, getFinancialPolicy, saveFinancialPolicy, simulateFinancialPolicy } from './financial-policy.service';
import { defaultOwner, emptyPolicy, laneKey, type Lane } from './financial-policy';

const user = { sub: 'owner', role: 'USER', email: 'owner@example.com' } as const;
const key = laneKey('DOM', 'CREDIT_CARD', 'ONLINE', 2);
function fixture(role = 'USER', ownerUserId = 'owner') {
  const global = emptyPolicy();
  const lane: Lane = { active: true, contract: { reference: 'Signed', fixedCents: 100, ratePpm: 20_000, cashbackCents: 0, interestPpm: 10_000, base: 'ORIGINAL' }, sim: { fixedCents: 50, ratePpm: 30_000, interestPpm: 20_000 } };
  for (let n = 1; n <= 12; n++) global.lanes[laneKey('DOM', 'CREDIT_CARD', 'ONLINE', n)] = structuredClone(lane);
  const revisions: any[] = [{ tag: 'GLOBAL', version: 1, document: global }, { tag: 'SHOP', version: 1, document: emptyPolicy() }];
  const findMany = mock(async () => [...new Map([...revisions].sort((a, b) => b.version - a.version).map(row => [row.tag, row])).values()]);
  const prisma: any = {
    user: { findUnique: mock(async () => ({ isActive: true, isPurged: false, role })) },
    platform: { findUnique: mock(async () => ({ ownerUserId })) },
    financialPolicyRevision: { findMany, findFirst: mock(async () => [...revisions].reverse().find(row => row.tag === 'SHOP')), create: mock(async ({ data }: any) => { revisions.push(data); return data; }) },
  };
  // Return the latest distinct revision, like Prisma's ordered distinct query.
  findMany.mockImplementation(async () => ['GLOBAL', 'SHOP'].map(tag => [...revisions].filter(row => row.tag === tag).sort((a, b) => b.version - a.version)[0]).filter(Boolean));
  prisma.$transaction = async (run: any) => run(prisma);
  return { prisma, revisions };
}

describe('financial contracts and authorization', () => {
  test('owner configuration omits contracts, cashback, acquirer costs and SimIntPay margin', async () => {
    const { prisma } = fixture();
    const result = await getFinancialPolicy(prisma, 'SHOP', user);
    expect(result.data).not.toHaveProperty('lanes');
    expect(result.data).not.toHaveProperty('globalLanes');
    expect(result.data).not.toHaveProperty('laneOverrides');
    expect(result.data.version).toBe('1:1');
    const response = await simulateFinancialPolicy(prisma, 'SHOP', user, { amountCents: 10000, acquirer: 'DOM', method: 'CREDIT_CARD', channel: 'ONLINE', installments: [2] });
    expect(response.data).toHaveLength(1);
    expect(response.data[0].result).not.toHaveProperty('simMarginCents');
    expect(response.data[0].result).not.toHaveProperty('acquirerCostCents');
  });
  test('one authorization and one configuration load per multi-row simulation', async () => {
    const { prisma } = fixture();
    const response = await simulateFinancialPolicy(prisma, 'SHOP', user, { amountCents: 10000, acquirer: 'DOM', method: 'CREDIT_CARD', channel: 'ONLINE', installments: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
    expect(response.data).toHaveLength(12);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.platform.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.financialPolicyRevision.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.financialPolicyRevision.create).not.toHaveBeenCalled();
  });
  test('foreign owners, integration sessions and forged admin claims cannot access internal costs', async () => {
    const { prisma } = fixture('USER', 'other');
    await expect(getFinancialPolicy(prisma, 'SHOP', { ...user, role: 'ADMIN' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(getFinancialPolicy(prisma, 'SHOP', { ...user, authMode: 'integration' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(getFinancialPolicy(fixture().prisma, 'GLOBAL', user)).rejects.toBeInstanceOf(ForbiddenException);
  });
  test('owners cannot alter costs using save or draft fields', async () => {
    const { prisma } = fixture();
    await expect(saveFinancialPolicy(prisma, 'SHOP', user, { version: '1:1', lanes: {} })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(simulateFinancialPolicy(prisma, 'SHOP', user, { amountCents: 10000, acquirer: 'DOM', method: 'CREDIT_CARD', channel: 'ONLINE', installments: [2], draft: { lanes: {} } })).rejects.toBeInstanceOf(ForbiddenException);
  });
  test('optimistic version conflict cannot replace another revision', async () => {
    const { prisma } = fixture();
    await expect(saveFinancialPolicy(prisma, 'SHOP', user, { version: 'old', owner: {} })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.financialPolicyRevision.create).not.toHaveBeenCalled();
  });
  test('save appends audited revision, preserves old configuration and explicit zero', async () => {
    const { prisma, revisions } = fixture();
    const original = JSON.stringify(revisions);
    await saveFinancialPolicy(prisma, 'SHOP', user, { version: '1:1', owner: { [key]: { ...defaultOwner(), passInterestPpm: 0 } }, interestFree: true });
    expect(JSON.stringify(revisions.slice(0, 2))).toBe(original);
    expect(revisions[2]).toMatchObject({ actorId: 'owner', version: 2, document: { interestFree: true, owner: { [key]: { fixedCents: 0, passInterestPpm: 0 } } } });
  });
  test('only requested installments are calculated; row failure remains isolated', async () => {
    const { prisma, revisions } = fixture();
    delete revisions[0].document.lanes[key];
    const result = await simulateFinancialPolicy(prisma, 'SHOP', user, { amountCents: 10000, acquirer: 'DOM', method: 'CREDIT_CARD', channel: 'ONLINE', installments: [1, 2] });
    expect(result.data[0].result).toBeDefined();
    expect(result.data[1].error).toBeDefined();
    expect(result.data).toHaveLength(2);
  });
});

describe('automatic administrative rate inheritance', () => {
  test('new platform inherits global rates without own revision or activation', async () => {
    const { prisma, revisions } = fixture();
    revisions.splice(1);
    for (const lane of Object.values(revisions[0].document.lanes) as Lane[]) {
      lane.active = false; // Older drafts no longer require a separate activation.
      lane.contract.reference = '';
    }
    const config = await getFinancialPolicy(prisma, 'SHOP', user);
    expect(config.data.version).toBe('1:0');
    expect(config.data.keys).toContain(key);
    expect(config.data.ownerOverrides).toEqual({});
    const quote = quoteFinancialCharge({ policy: await loadFinancialPolicy(prisma, 'SHOP'), acquirer: 'DOM', tag: 'SHOP' }, 100, 'CREDIT_CARD', 2)!;
    expect(quote.netAmount).toBe(90.5);
    const response = await simulateFinancialPolicy(prisma, 'SHOP', user, {
      version: '1:0', amountCents: 10000, acquirer: 'DOM', method: 'CREDIT_CARD', channel: 'ONLINE', installments: [2],
    });
    expect(response.data[0].error).toBeUndefined();
    expect(response.data[0].result).toMatchObject({ buyerTotalCents: 10000, contractedCostCents: 950, netCents: 9050 });
    expect(prisma.financialPolicyRevision.create).not.toHaveBeenCalled();
  });

  test('owner additions and partial interest absorption preserve inherited administrative costs and match checkout', async () => {
    const { prisma, revisions } = fixture();
    const owner = { [key]: { fixedCents: 100, ratePpm: 10000, passInterestPpm: 500000 } };
    const globalBefore = JSON.stringify(revisions[0]);
    await saveFinancialPolicy(prisma, 'SHOP', user, { version: '1:1', owner });
    const response = await simulateFinancialPolicy(prisma, 'SHOP', user, {
      amountCents: 10000, acquirer: 'DOM', method: 'CREDIT_CARD', channel: 'ONLINE', installments: [2],
    });
    expect(response.data[0].result).toMatchObject({ buyerAdditionCents: 200, buyerInterestCents: 150, contractedCostCents: 950, buyerTotalCents: 10350, netCents: 9400 });
    expect(JSON.stringify(revisions[0])).toBe(globalBefore);
    const policy = await loadFinancialPolicy(prisma, 'SHOP');
    const quote = quoteFinancialCharge({ policy, acquirer: 'DOM', tag: 'SHOP' }, 100, 'CREDIT_CARD', 2)!;
    expect(quote.totalAmount).toBe(103.5);
    expect(quote.netAmount).toBe(94);
  });

  test('missing global rates report missing configuration, never an activation requirement', async () => {
    const { prisma, revisions } = fixture();
    revisions[0].document.lanes = {};
    const response = await simulateFinancialPolicy(prisma, 'SHOP', user, {
      amountCents: 10000, acquirer: 'DOM', method: 'PIX', channel: 'ONLINE', installments: [1],
    });
    expect(response.data[0].error).toBe('Taxas administrativas não configuradas para esta modalidade, canal e parcela');
  });
});

test('admin can save rate configuration without reference or separate table activation', async () => {
  const { prisma, revisions } = fixture('ADMIN');
  const lane = structuredClone(revisions[0].document.lanes[key]) as Lane;
  lane.active = false;
  lane.contract.reference = '';
  lane.sim.ratePpm = 40000;
  const saved = await saveFinancialPolicy(prisma, 'SHOP', user, { version: '1:1', lanes: { [key]: lane } });
  expect(saved.data.keys).toContain(key);
  const result = await simulateFinancialPolicy(prisma, 'SHOP', user, {
    amountCents: 10000, acquirer: 'DOM', method: 'CREDIT_CARD', channel: 'ONLINE', installments: [2],
  });
  expect(result.data[0].result?.contractedCostCents).toBe(1050);
});
