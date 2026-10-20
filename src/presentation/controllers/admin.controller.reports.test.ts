import { expect, mock, test } from 'bun:test';
import { AdminController } from './admin.controller';

test('monthly sales count and recorded fees include every acquirer, and honor exact period and method', async () => {
  const findMany = mock(async () => [
    { userId: 'owner', amount: 100, netAmount: 90, domFee: 1.5, acquirer: 'DOM', createdAt: new Date('2026-10-05T12:00:00Z'), description: '[TENANT:RENOVADA]', installments: 1 },
    { userId: 'owner', amount: 200, netAmount: 180, domFee: 2.25, acquirer: 'FRENDZ', createdAt: new Date('2026-10-06T12:00:00Z'), description: '[TENANT:RENOVADA]', installments: 1 },
  ]);
  const controller = { prisma: {
    platform: { findMany: async () => [{ tag: 'RENOVADA', ownerUserId: 'owner' }] },
    communityLinkBinding: { findMany: async () => [] },
    transaction: { findMany },
  } };
  const result = await AdminController.prototype.getRelatorioMensal.call(controller as any, '1', '2026-10-01', '2026-10-19', 'PIX');
  expect(result.meses).toHaveLength(1);
  expect(result.meses[0]).toMatchObject({ mes: '2026-10', vendas: 2, valorBruto: 300, taxaAdquirente: 3.75 });
  const query = (findMany.mock.calls as any)[0][0];
  expect(query.where.paymentMethod).toBe('PIX');
  expect(query.where.createdAt.gte.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  expect(query.where.createdAt.lte.toISOString()).toBe('2026-10-20T02:59:59.999Z');
});

test('consolidated sales apply payment method before counting and pagination', async () => {
  const findMany = mock(async (_query: any) => []);
  const count = mock(async (_query: any) => 0);
  const controller = { prisma: { platform: { findMany: async () => [{ tag: 'RENOVADA', ownerUserId: 'owner' }] }, transaction: { findMany, count } } };
  await AdminController.prototype.listConsolidadoTransacoes.call(controller as any, '1', '20', '2026-10-01', '2026-10-19', undefined, undefined, undefined, undefined, undefined, 'PIX');
  expect(findMany.mock.calls[0][0].where.paymentMethod).toBe('PIX');
  expect(count.mock.calls[0][0].where.paymentMethod).toBe('PIX');
});
