import { expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformLedger } from './platform-ledger';
const input = {
  userId: 'seller',
  domPaymentId: 'invoice-1',
  amount: '10.00',
  netAmount: '9.50',
  status: 'COMPLETED' as const,
  paymentMethod: 'PIX' as const,
  description: 'sale [TENANT:PAGATG]',
};
function fixture() {
  let stored: any = null;
  const p: any = {
    platform: {
      findUnique: mock(async () => ({
        isActive: true,
        acquirer: 'DOM',
        owner: { isActive: true, isPurged: false },
      })),
    },
    user: {
      findUnique: mock(async () => ({ isActive: true, isPurged: false })),
    },
    transaction: {
      findUnique: mock(async () => stored),
      create: mock(async ({ data }: any) => {
        stored = { id: 'entry', ...data };
        return stored;
      }),
    },
    wallet: {
      upsert: mock(async () => ({})),
      update: mock(async () => ({})),
      // The BalanceLog trigger moves the wallet; the ledger only reads it back.
      findUniqueOrThrow: mock(async () => ({
        balance: new Prisma.Decimal(0),
        lockedBalance: new Prisma.Decimal(0),
      })),
    },
    balanceLog: { create: mock(async () => ({})) },
    $transaction: async (f: any) => f(p),
  };
  return {
    p,
    ledger: new PlatformLedger(p),
    set: (value: any) => {
      stored = value;
    },
  };
}
test('completed external invoice credits wallet once; replay preserves entry', async () => {
  const { p, ledger } = fixture();
  expect(await ledger.record('PAGATG', input, true)).toEqual({
    success: true,
    id: 'entry',
    created: true,
  });
  expect(await ledger.record('PAGATG', input, true)).toEqual({
    success: true,
    id: 'entry',
    created: false,
  });
  expect(p.balanceLog.create).toHaveBeenCalledTimes(1);
  expect(
    p.balanceLog.create.mock.calls[0][0].data.balanceDelta.toString(),
  ).toBe('9.5');
});
test('pending order and affiliate commission keep legacy no-wallet semantics', async () => {
  for (const status of ['PENDING', 'COMPLETED'] as const) {
    const { p, ledger } = fixture();
    await ledger.record('EBOOK', {
      ...input,
      description: '[TENANT:EBOOK]',
      status,
    });
    expect(p.balanceLog.create).not.toHaveBeenCalled();
  }
});
test('duplicate provider reference cannot cross platforms/accounts or change values', async () => {
  for (const change of [
    { userId: 'foreign' },
    { amount: '11' },
    { netAmount: '8' },
    { platformTag: 'OTHER' },
  ]) {
    const { p, ledger, set } = fixture();
    set({ id: 'prior', ...input, platformTag: 'PAGATG', ...change });
    await expect(ledger.record('PAGATG', input, true)).rejects.toThrow(
      'Referência já vinculada',
    );
    expect(p.balanceLog.create).not.toHaveBeenCalled();
  }
});
test('concurrent unique winner replays without second wallet credit', async () => {
  const { p, ledger, set } = fixture();
  p.transaction.create.mockImplementation(async () => {
    set({ id: 'winner', ...input, platformTag: 'PAGATG' });
    throw { code: 'P2002' };
  });
  expect(await ledger.record('PAGATG', input, true)).toMatchObject({
    id: 'winner',
    created: false,
  });
  expect(p.balanceLog.create).not.toHaveBeenCalled();
});
test('inactive product, account and unsupported acquirer block writes', async () => {
  for (const mode of ['platform', 'account', 'acquirer']) {
    const { p, ledger } = fixture();
    if (mode === 'platform')
      p.platform.findUnique.mockImplementation(async () => ({
        isActive: false,
      }));
    if (mode === 'account')
      p.user.findUnique.mockImplementation(async () => ({ isActive: false }));
    if (mode === 'acquirer')
      p.platform.findUnique.mockImplementation(async () => ({
        isActive: true,
        acquirer: 'FRENDZ',
        owner: { isActive: true },
      }));
    await expect(ledger.record('PAGATG', input, true)).rejects.toThrow();
    expect(p.transaction.create).not.toHaveBeenCalled();
  }
});
test('invalid net amount and conflicting platform markers block writes', async () => {
  for (const change of [
    { netAmount: '-1' },
    { netAmount: '11' },
    { description: '[TENANT:PAGATG] [TENANT:OTHER]' },
  ]) {
    const { p, ledger } = fixture();
    await expect(
      ledger.record('PAGATG', { ...input, ...change }, true),
    ).rejects.toThrow();
    expect(p.transaction.create).not.toHaveBeenCalled();
  }
});
test('ownership transfer invalidates canonical import context', async () => {
  const { p, ledger } = fixture();
  await expect(
    ledger.record('PAGATG', input, true, 'old-owner'),
  ).rejects.toThrow();
  expect(p.transaction.create).not.toHaveBeenCalled();
});

test('imports persist owner attribution and fees from original gross/net amounts', async () => {
  const { p, ledger } = fixture();
  p.platform.findUnique.mockImplementation(async () => ({
    id: 'platform',
    ownerUserId: 'owner',
    isActive: true,
    acquirer: 'DOM',
    owner: { isActive: true },
  }));
  await ledger.record('PAGATG', input);
  const data = p.transaction.create.mock.calls[0][0].data;
  expect(data.totalFee.toString()).toBe('0.5');
  expect(data.tracking).toEqual({
    reportAttribution: {
      platformId: 'platform',
      ownerUserId: 'owner',
      beneficiaryUserId: 'seller',
    },
  });
});
