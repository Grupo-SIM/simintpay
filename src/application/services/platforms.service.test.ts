import { describe, expect, mock, test } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { PlatformsService } from './platforms.service';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

const user = { sub: 'owner', email: 'owner@example.com', role: 'USER' };

function service(platform = { id: 'platform', tag: 'SHOP', ownerUserId: 'owner' }) {
  const update = mock(async () => platform);
  const prisma = { financialPolicyRevision: { findMany: async () => [] }, platform: { findUnique: mock(async () => platform), update }, user: { findFirst: mock(async () => null), findUnique: mock(async () => ({ id: 'owner', role: 'USER', isActive: true, isPurged: false })) } };
  return { service: new PlatformsService(prisma as unknown as PrismaService), update };
}

describe('Platform ownership', () => {
  test('owner cannot transfer platform', async () => {
    const fixture = service();
    await expect(fixture.service.update('SHOP', user, { ownerUserId: 'other' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.update).not.toHaveBeenCalled();
  });
  test('different owner cannot edit platform', async () => {
    const fixture = service({ id: 'platform', tag: 'SHOP', ownerUserId: 'other' });
    await expect(fixture.service.update('SHOP', user, { name: 'Renamed' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.update).not.toHaveBeenCalled();
  });
  test('owner cannot create platform assigned to another user', async () => {
    const fixture = service();
    await expect(fixture.service.create(user, { tag: 'SHOP', name: 'Shop', ownerUserId: 'other' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// No database or legacy module repository: products are Platform records only.
describe('Platform product ownership', () => {
  test('one owner creates multiple products without creating a module or replacing membership', async () => {
    const rows: any[] = [];
    const create = mock(async ({ data }: any) => { const row = { ...data, id: data.tag, isActive: true, acquirer: 'DOM', customerInterestRates: {} }; rows.push(row); return row; });
    const prisma = { user: { findUnique: async () => ({ role: 'USER', isActive: true, isPurged: false }), findFirst: async () => ({ id: 'owner' }) },
      platform: { create, findMany: async () => rows } };
    const service = new PlatformsService(prisma as never);
    const actor = { sub: 'owner', role: 'USER' } as never;
    await service.create(actor, { tag: 'PRODUCT-A', name: 'A' });
    await service.create(actor, { tag: 'PRODUCT-B', name: 'B' });
    expect(rows.map(row => row.ownerUserId)).toEqual(['owner', 'owner']);
    expect(rows.map(row => row.tag)).toEqual(['PRODUCT-A', 'PRODUCT-B']);
    expect(rows.every(row => row.absorbCustomerInterest === true)).toBe(true);
    expect(create.mock.calls.every(([arg]) => !('platformId' in arg.data))).toBe(true);
  });
});

describe('Platform draft simulation', () => {
  test('simulates owner draft without persisting and rejects foreign owner', async () => {
    const fixture = service();
    const result = await fixture.service.simulateDraft('SHOP', user as never, { amount: 200, rates: { '2': 0.05 } });
    expect(result.data).toHaveLength(12);
    expect(result.data[1].interestAmount).toBe(10);
    expect(fixture.update).not.toHaveBeenCalled();
    await expect(service({ id: 'p', tag: 'SHOP', ownerUserId: 'other' }).service.simulateDraft('SHOP', user as never, { amount: 200 })).rejects.toBeInstanceOf(ForbiddenException);
  });
  test('rejects malformed draft rates and invalid amounts', async () => {
    await expect(service().service.simulateDraft('SHOP', user as never, { amount: 200, rates: { '13': 0.05 } })).rejects.toThrow();
    await expect(service().service.simulateDraft('SHOP', user as never, { amount: -1 })).rejects.toThrow();
  });
});


describe('Platform rate atomic update', () => {
  test('persists interest and absorption together, rejects invalid absorption before writing', async () => {
    let data: unknown;
    const platform = { id: 'p', tag: 'SHOP', ownerUserId: 'owner', customerInterestRates: {} };
    const update = mock(async (args: any) => { data = args.data; return { ...platform, ...args.data }; });
    const prisma = {
      financialPolicyRevision: { findMany: async () => [] },
      user: { findUnique: async () => ({ isActive: true, isPurged: false, role: 'USER' }) },
      platform: { findUnique: async () => platform, update, findMany: async () => [] },
      platformTaxaOverride: { findMany: async () => [] },
    };
    const service = new PlatformsService(prisma as never);
    await service.patchCustomerInterestRates('SHOP', user as never, { rates: { '2': 0.025 }, absorbCustomerInterest: true });
    expect(data).toEqual({ customerInterestRates: { '2': 0.025 }, absorbCustomerInterest: true });
    await expect(service.patchCustomerInterestRates('SHOP', user as never, { absorbCustomerInterest: 'yes' as never })).rejects.toThrow();
    expect(update).toHaveBeenCalledTimes(1);
    await service.patchCustomerInterestRates('SHOP', user as never, { absorbCustomerInterest: false });
    expect(update).toHaveBeenCalledTimes(2);
  });
});
