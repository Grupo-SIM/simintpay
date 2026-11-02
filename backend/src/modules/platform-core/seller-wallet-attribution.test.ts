import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { readSellerWalletAttribution } from './seller-wallet-attribution';

const row = (
  platformTag: string | null,
  balance: number,
  nature: string | null = 'sale',
) => ({
  userId: 'beneficiary',
  platformTag,
  nature,
  balance: new Prisma.Decimal(balance),
  locked: new Prisma.Decimal(0),
  rowCount: 1n,
  walletBalance: new Prisma.Decimal(8),
  walletLocked: new Prisma.Decimal(0),
});

test('seller attribution batches and deduplicates beneficiaries, aliases and preserves signed balances', async () => {
  let calls = 0;
  const client = {
    $queryRaw: async () => {
      calls++;
      return [row('EBOOKSIM', -2), row('EBOOK', 3), row('ATLAS', 7)];
    },
  } as any;
  const balances = await readSellerWalletAttribution(
    client,
    ['beneficiary', 'beneficiary'],
    'EBOOK',
  );
  expect(calls).toBe(1);
  expect(balances.get('beneficiary')).toMatchObject({
    balance: 1,
    lockedBalance: 0,
    balanceStatus: 'complete',
  });
  expect(
    (
      await readSellerWalletAttribution(client, ['beneficiary'], 'EBOOKSIM')
    ).get('beneficiary')?.balance,
  ).toBe(1);
});

test('unknown tags or natures and mismatched caches do not become zero or pooled balances', async () => {
  for (const rows of [
    [row(null, 8)],
    [row('EBOOK', 8, null)],
    [row('EBOOK', 1)],
  ]) {
    const client = { $queryRaw: async () => rows } as any;
    expect(
      (await readSellerWalletAttribution(client, ['beneficiary'], 'EBOOK')).get(
        'beneficiary',
      ),
    ).toMatchObject({
      balance: null,
      lockedBalance: null,
      balanceStatus: 'unavailable',
    });
  }
});

test('missing history is unavailable, complete history for another platform is a known zero', async () => {
  const empty = {
    ...row(null, 0),
    rowCount: 0n,
    walletBalance: new Prisma.Decimal(0),
  };
  expect(
    (
      await readSellerWalletAttribution(
        { $queryRaw: async () => [empty] } as any,
        ['beneficiary'],
        'EBOOK',
      )
    ).get('beneficiary')?.balance,
  ).toBeNull();
  expect(
    (
      await readSellerWalletAttribution(
        { $queryRaw: async () => [row('ATLAS', 8)] } as any,
        ['beneficiary'],
        'EBOOK',
      )
    ).get('beneficiary')?.balance,
  ).toBe(0);
});
