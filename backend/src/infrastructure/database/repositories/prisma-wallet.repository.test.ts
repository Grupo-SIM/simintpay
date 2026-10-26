import { expect, mock, test } from 'bun:test';
import { PrismaWalletRepository } from './prisma-wallet.repository';

test('ensuring wallet preserves existing balances and version', async () => {
  const existing = { userId: 'owner', balance: 150, lockedBalance: 25, version: 9 };
  const upsert = mock(async ({ where, update, create }: any) => {
    expect(where).toEqual({ userId: 'owner' });
    expect(update).toEqual({});
    expect(create).toEqual({ userId: 'owner', balance: 0, lockedBalance: 0 });
    return existing;
  });
  const wallets = new PrismaWalletRepository({ wallet: { upsert } } as never);
  expect(await wallets.createForUser('owner')).toEqual(existing as never);
  expect(await wallets.createForUser('owner')).toEqual(existing as never);
});
