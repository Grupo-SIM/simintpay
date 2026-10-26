import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { allocateNet, validateAgreement, type Snapshot } from './coproduction';
const snapshot: Snapshot = { basis: 'NET', version: 1, product: 'planos', productId: 'p', ownerUserId: 'owner', participants: [{ userId: 'a', percentageBps: 3333 }, { userId: 'b', percentageBps: 3333 }] };
test('cent conservation, deterministic residue and zero-cent shares', () => {
  const allocations = allocateNet(snapshot, new Prisma.Decimal('10.01'));
  expect(allocations.map(p => [p.userId, p.amount.toFixed(2)])).toEqual([['a', '3.33'], ['b', '3.33'], ['owner', '3.35']]);
  expect(allocateNet(snapshot, new Prisma.Decimal('0.01')).find(p => p.userId === 'owner')?.amount.toFixed(2)).toBe('0.01');
  expect(() => allocateNet(snapshot, new Prisma.Decimal('-1'))).toThrow();
  expect(() => allocateNet(snapshot, new Prisma.Decimal('0.001'))).toThrow();
});
test('server rejects malformed, excessive and duplicate participants', () => {
  const input = { basis: 'NET', version: 0, participants: [{ email: ' A@Example.Test ', percentageBps: 2550 }] };
  expect(validateAgreement(input).participants[0].email).toBe('a@example.test');
  for (const participants of [[{ email: 'bad', percentageBps: 1 }], [{ email: 'a@b.test', percentageBps: 1.5 }], [{ email: 'a@b.test', percentageBps: 10001 }], [{ email: 'a@b.test', percentageBps: 0 }], [{ email: 'a@b.test', percentageBps: 6000 }, { email: 'c@b.test', percentageBps: 6000 }], [{ email: 'a@b.test', percentageBps: 1 }, { email: ' A@b.test ', percentageBps: 1 }]]) expect(() => validateAgreement({ ...input, participants })).toThrow();
});
test('item base excludes freight; owner retains freight and fractional residue', () => {
 const itemSale: Snapshot = { ...snapshot, baseCents: 10000, participants: [{ userId: 'a', percentageBps: 500 }] };
 expect(allocateNet(itemSale, new Prisma.Decimal(110)).map(p => [p.userId, p.amount.toFixed(2)])).toEqual([['a', '5.00'], ['owner', '105.00']]);
 expect(allocateNet({ ...itemSale, baseCents: 0 }, new Prisma.Decimal(10)).find(p => p.userId === 'owner')!.amount.toFixed(2)).toBe('10.00');
 expect(() => allocateNet({ ...itemSale, baseCents: 11001 }, new Prisma.Decimal(110))).toThrow();
 expect(() => validateAgreement({ basis: 'NET', version: 0, mode: 'INHERIT', participants: [{ email: 'a@b.test', percentageBps: 500 }] })).toThrow();
});
