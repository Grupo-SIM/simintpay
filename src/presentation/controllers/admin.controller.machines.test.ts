import { expect, mock, test } from 'bun:test';
import { AdminController } from './admin.controller';

function fixture() {
  const row = {
    id: 'dd176345-4599-4bc4-bc11-0348ef957001',
    userId: 'current-owner',
    domPaymentId: 'payment-id', domTransactionId: null,
    description: 'Maquineta - Terminal: POS-RENOVADA [TENANT:RENOVADA] [ORIGEM:MAQUINETA]',
    amount: 240, netAmount: 218.4, status: 'COMPLETED', paymentMethod: 'PIX',
    installments: 1, createdAt: new Date('2026-10-18T23:30:19Z'), updatedAt: new Date('2026-10-19T16:50:01Z'),
  };
  const platform = { ownerUserId: 'current-owner', isActive: true, owner: { isActive: true, isPurged: false } };
  const prisma = {
    platform: { findUnique: mock(async (): Promise<typeof platform | null> => platform) },
    transaction: {
      findMany: mock(async (_query: any) => [row]),
      count: mock(async (_query: any) => 1),
    },
  };
  const ctx: any = { prisma };
  ctx.getMaquinetasFromDb = (AdminController.prototype as any).getMaquinetasFromDb.bind(ctx);
  return { prisma, ctx, row, platform };
}

test('Renovada machines use live active ownership and preserve original owner scope', async () => {
  const { ctx, prisma } = fixture();
  const result = await AdminController.prototype.renovadaMachines.call(ctx, '1', '100');
  expect(prisma.platform.findUnique).toHaveBeenCalledWith({
    where: { tag: 'RENOVADA' },
    select: { ownerUserId: true, isActive: true, owner: { select: { isActive: true, isPurged: true } } },
  });
  const query = prisma.transaction.findMany.mock.calls[0][0];
  expect(query.where.userId).toBe('current-owner');
  expect(query.where.OR).toEqual([
    { description: { contains: '[ORIGEM:MAQUINETA]', mode: 'insensitive' } },
    { description: { contains: 'Terminal:', mode: 'insensitive' } },
    { description: { contains: 'Maquineta', mode: 'insensitive' } },
  ]);
  expect(prisma.transaction.count).toHaveBeenCalledWith({ where: query.where });
  expect(result.meta).toEqual({ page: 1, limit: 100, total: 1, totalPages: 1 });
  expect(result.transactions[0]).toMatchObject({ terminal: 'POS-RENOVADA', netAmount: 218.4, profit_minus_tax: 218.4, status: 'completed', payment_method: 'pix' });
});

test('central machines alias preserves date filters, pagination and full migrated terminal serial', async () => {
  const { ctx, prisma, row } = fixture();
  row.description = 'Maquineta - Terminal: POS-MIG-RENOVADA [TENANT:RENOVADA]';
  const result = await AdminController.prototype.getMaquinetas.call(ctx, '2', '10', '2026-10-01', '2026-10-19');
  const query = prisma.transaction.findMany.mock.calls[0][0];
  expect(query).toMatchObject({ skip: 10, take: 10, orderBy: { createdAt: 'desc' } });
  expect(query.where.createdAt.gte).toBeInstanceOf(Date);
  expect(query.where.createdAt.lte).toBeInstanceOf(Date);
  expect(result.transactions[0].terminal).toBe('POS-MIG-RENOVADA');
});

for (const state of ['missing', 'inactive-platform', 'inactive-owner', 'purged-owner']) {
  test(`${state} preserves empty response without querying transactions`, async () => {
    const { ctx, prisma, platform } = fixture();
    if (state === 'missing') prisma.platform.findUnique.mockImplementation(async () => null);
    if (state === 'inactive-platform') platform.isActive = false;
    if (state === 'inactive-owner') platform.owner.isActive = false;
    if (state === 'purged-owner') platform.owner.isPurged = true;
    expect(await AdminController.prototype.renovadaMachines.call(ctx, '2', '100')).toEqual({
      transactions: [], meta: { page: 2, limit: 100, total: 0, totalPages: 0 },
    });
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    expect(prisma.transaction.count).not.toHaveBeenCalled();
  });
}

test('owner transfer keeps even explicitly tagged history restricted to current owner', async () => {
  const { ctx, prisma, platform } = fixture();
  platform.ownerUserId = 'new-owner';
  prisma.transaction.findMany.mockImplementation(async () => []);
  prisma.transaction.count.mockImplementation(async () => 0);
  await AdminController.prototype.renovadaMachines.call(ctx, '1', '100');
  const query = prisma.transaction.findMany.mock.calls[0][0];
  expect(query.where.userId).toBe('new-owner');
  expect(query.where.OR.every((condition: any) => !('userId' in condition))).toBe(true);
  expect(prisma.transaction.count).toHaveBeenCalledWith({ where: query.where });
});
