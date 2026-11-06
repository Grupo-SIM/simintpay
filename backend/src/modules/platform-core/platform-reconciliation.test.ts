import { expect, mock, test } from 'bun:test';
import { PlatformReconciliation } from './platform-reconciliation';
import { InternalReconcileController } from '../../presentation/controllers/internal-reconcile.controller';
import { ReconcilePendingTransactionsUseCase } from '../../application/use-cases/webhook/reconcile-pending-transactions.use-case';
function fixture() {
  const context = {
    id: 'p',
    tag: 'RENOVADA',
    ownerUserId: 'owner',
    acquirer: 'DOM' as const,
  };
  const platform = {
    ...context,
    isActive: true,
    owner: { isActive: true },
  };
  const prisma: any = { platform: { findUnique: async () => platform } };
  const reconciliation: any = {
    execute: mock(async () => ({ checked: 1, completed: 1, details: [] })),
  };
  return {
    context,
    platform,
    prisma,
    reconciliation,
    service: new PlatformReconciliation(prisma, reconciliation),
  };
}
test('Renovada alias and canonical reconciliation preserve response and scoped options', async () => {
  const { context, prisma, reconciliation, service } = fixture();
  const key = process.env.API_MACHINE_INTERNAL_TOKEN;
  process.env.API_MACHINE_INTERNAL_TOKEN = 'legacy';
  process.env.DOM_TOKEN = 'global-token';
  try {
    const legacy = await new InternalReconcileController(
      reconciliation,
      prisma,
    ).reconcile('owner', '720', 'legacy');
    expect(legacy).toEqual(
      await service.run('RENOVADA', 720, undefined, context),
    );
    expect(reconciliation.execute.mock.calls[0]).toEqual(
      reconciliation.execute.mock.calls[1],
    );
    expect(reconciliation.execute.mock.calls[0][0]).toMatchObject({
      platformTag: 'RENOVADA',
      domToken: 'global-token',
      userId: 'owner',
      direct: true,
      limit: 500,
    });
  } finally {
    delete process.env.DOM_TOKEN;
    if (key === undefined) delete process.env.API_MACHINE_INTERNAL_TOKEN;
    else process.env.API_MACHINE_INTERNAL_TOKEN = key;
  }
});
test('missing token and unsupported acquirer fail before reconciliation', async () => {
  const { platform, reconciliation, service } = fixture();
  delete process.env.DOM_TOKEN;
  await expect(service.run('RENOVADA')).rejects.toMatchObject({
    response: { code: 'PLATFORM_CAPABILITY_UNAVAILABLE' },
  });
  (platform as any).acquirer = 'FRENDZ';
  await expect(service.run('RENOVADA')).rejects.toThrow();
  expect(reconciliation.execute).not.toHaveBeenCalled();
});
test('inactive owner, transferred owner and invalid hours cannot reconcile', async () => {
  const { platform, context, reconciliation, service } = fixture();
  await expect(service.run('RENOVADA', NaN)).rejects.toThrow();
  await expect(
    service.run('RENOVADA', 720, undefined, { ...context, ownerUserId: 'old' }),
  ).rejects.toThrow();
  platform.owner.isActive = false;
  await expect(service.run('RENOVADA')).rejects.toThrow();
  expect(reconciliation.execute).not.toHaveBeenCalled();
});
test('scoped reconciler excludes foreign and untagged rows before gateway calls', async () => {
  const rows = ['RENOVADA', 'BOSQUE', null, 'BOSQUE'].map((platformTag, i) => ({
    id: String(i),
    userId: 'owner',
    description: 'edited',
    platformTag,
    domPaymentId: `payment-${i}`,
  }));
  const p: any = {
    transaction: {
      findMany: mock(async ({ where }: any) =>
        rows.filter((row) => row.platformTag === where.platformTag),
      ),
    },
  };
  const gateway: any = {
    getDomTransactionDetail: mock(async () => ({ status: 'pending' })),
  };
  const result = await new ReconcilePendingTransactionsUseCase(
    p,
    gateway,
    {} as any,
  ).execute({ platformTag: 'RENOVADA', direct: true, domToken: 'scoped' });
  expect(result.checked).toBe(1);
  expect(gateway.getDomTransactionDetail).toHaveBeenCalledTimes(1);
  expect(gateway.getDomTransactionDetail).toHaveBeenCalledWith(
    'scoped',
    'payment-0',
  );
  expect(p.transaction.findMany.mock.calls[0][0].where.platformTag).toBe(
    'RENOVADA',
  );
});
