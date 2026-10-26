import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformAttributedBalance } from './platform-attributed-balance';
const context = { id: 'p', tag: 'BOSQUE', ownerUserId: 'owner', acquirer: 'DOM' as const };
function fixture() {
  const d = (n: number) => new Prisma.Decimal(n);
  const rows = [{ description: '[TENANT:BOSQUE]', netAmount: d(100) }, { description: '[TENANT:RENOVADA]', netAmount: d(900) }, { description: 'historical unidentified', netAmount: d(50) }, { description: '[TENANT:BOSQUE]', netAmount: null }, { description: '[TENANT:BOSQUE] [TENANT:RENOVADA]', netAmount: d(500) }];
  const withdrawals = [{ grossAmount: d(20), status: 'COMPLETED' }, { grossAmount: d(10), status: 'PENDING' }];
  const p: any = { platform: { findUnique: async () => ({ ...context, isActive: true, owner: { isActive: true } }), count: async () => 2 }, transaction: { findMany: async () => rows }, withdrawRequest: { count: async () => 0, findMany: async (q: any) => { expect(q.where.platform).toEqual({ in: ['bosque', 'bosque-baseline'], mode: 'insensitive' }); return withdrawals; } }, wallet: { findUnique: async () => ({ balance: d(1000) }) }, $transaction: async (f: any) => f(p) };
  return { p, rows, withdrawals, service: new PlatformAttributedBalance(p) };
}
test('product balance remains available beside shared wallet without assigning unidentified history', async () => {
  const { service } = fixture();
  expect(await service.read(context)).toMatchObject({ scope: 'platform-ledger', walletScope: 'shared-owner', ownerWalletBalanceCents: 100000,
    earnedCents: 10000, withdrawnGrossCents: 2000, pendingWithdrawalsGrossCents: 1000, balanceCents: 8000, availableBalanceCents: 7000,
    identifiedTransactions: 1, unidentifiedOwnerTransactions: 1, missingNetSnapshots: 1, historicalAttributionComplete: false });
});
test('negative product result is explicit; available amount never negative', async () => {
  const { service, withdrawals } = fixture();
  withdrawals[0].grossAmount = new Prisma.Decimal(120);
  expect(await service.read(context)).toMatchObject({ balanceCents: -2000, availableBalanceCents: 0 });
});
test('ownership transfer blocks stale product balance request', async () => {
  const { p, service } = fixture();
  p.platform.findUnique = async () => ({ ...context, ownerUserId: 'new-owner', isActive: true, owner: { isActive: true } });
  await expect(service.read(context)).rejects.toThrow('Contexto da plataforma mudou');
});

test('ambiguous transactions and untagged withdrawals prevent complete attribution', async () => {
  const { service, p, rows } = fixture();
  rows.splice(2, 2);
  p.withdrawRequest.count = async () => 1;
  expect(await service.read(context)).toMatchObject({ conflictingOwnerTransactions: 1, unidentifiedOwnerWithdrawals: 1, historicalAttributionComplete: false });
});
test('complete explicitly tagged history is reported complete', async () => {
  const { service, rows } = fixture();
  rows.splice(2);
  expect(await service.read(context)).toMatchObject({ historicalAttributionComplete: true, balanceCents: 8000 });
});

test('Bosque administrative baseline remains part of attributed product balance', async () => {
  const { service, withdrawals } = fixture();
  withdrawals.push({ grossAmount: new Prisma.Decimal(80), status: 'COMPLETED' });
  expect(await service.read(context)).toMatchObject({ balanceBasis: 'persisted-net', balanceCents: 0, availableBalanceCents: 0 });
});

test('inactive history uses authorized snapshot; operational balance remains blocked', async () => {
  const { p, service } = fixture();
  p.platform.findUnique = async () => ({ ...context, isActive: false, owner: { isActive: true } });
  await expect(service.read(context)).rejects.toThrow('Contexto da plataforma mudou');
  expect(await service.readSnapshot(p, context, true)).toMatchObject({ balanceCents: 8000, walletScope: 'shared-owner' });
});

test('equivalent Ebook historical tags share attribution and withdrawal aliases', async () => {
  const { p, rows, service } = fixture();
  const ebook = { ...context, tag: 'EBOOK' };
  p.platform.findUnique = async () => ({ ...ebook, isActive: true, owner: { isActive: true } });
  p.withdrawRequest.findMany = async (query: any) => { expect(query.where.platform.in).toEqual(['ebook', 'ebooksim']); return []; };
  rows.splice(0, rows.length, { description: '[TENANT:EBOOKSIM] [TENANT:EBOOK]', netAmount: new Prisma.Decimal(15) });
  expect(await service.read(ebook)).toMatchObject({ earnedCents: 1500, balanceCents: 1500, historicalAttributionComplete: true });
});
