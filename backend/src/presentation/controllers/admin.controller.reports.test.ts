import { beforeEach, expect, mock, test } from 'bun:test';
import { AdminController } from './admin.controller';
import { initializePlatformTaxasCache } from '../../modules/platform-taxas/platform-taxas.store';

beforeEach(async () => {
  await initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as never);
});

test('monthly sales count and recorded fees include every acquirer, and honor exact period and method', async () => {
  const findMany = mock(async () => [
    {
      userId: 'owner',
      amount: 100,
      netAmount: 90,
      acquirerFee: 1.5,
      acquirer: 'DOM',
      createdAt: new Date('2026-10-05T12:00:00Z'),
      description: '[TENANT:RENOVADA]',
      installments: 1,
    },
    {
      userId: 'owner',
      amount: 200,
      netAmount: 180,
      acquirerFee: 2.25,
      acquirer: 'FRENDZ',
      createdAt: new Date('2026-10-06T12:00:00Z'),
      description: '[TENANT:RENOVADA]',
      installments: 1,
    },
  ]);
  const controller = {
    prisma: {
      platform: {
        findMany: async () => [{ tag: 'RENOVADA', ownerUserId: 'owner' }],
      },
      communityLinkBinding: { findMany: async () => [] },
      transaction: { findMany },
    },
  };
  const result = await AdminController.prototype.getRelatorioMensal.call(
    controller as any,
    '1',
    '2026-10-01',
    '2026-10-19',
    'PIX',
  );
  expect(result.meses).toHaveLength(1);
  expect(result.meses[0]).toMatchObject({
    mes: '2026-10',
    vendas: 2,
    valorBruto: 300,
    taxaAdquirente: 3.75,
  });
  const query = (findMany.mock.calls as any)[0][0];
  expect(query.where.paymentMethod).toBe('PIX');
  expect(query.where.createdAt.gte.toISOString()).toBe(
    '2026-10-01T03:00:00.000Z',
  );
  expect(query.where.createdAt.lte.toISOString()).toBe(
    '2026-10-20T02:59:59.999Z',
  );
});

test('consolidated profit uses buyer charge, seller repass and realized cost without repricing snapshots', async () => {
  const tx = {
    id: 'snapshot',
    userId: 'owner',
    platformTag: 'RENOVADA',
    amount: 100,
    netAmount: 90,
    financialSnapshot: {
      buyerTotalCents: 12000,
      acquirerCost: { realizedCents: 500 },
    },
    createdAt: new Date('2026-10-05T12:00:00Z'),
    description: '[TENANT:RENOVADA]',
    installments: 1,
    paymentMethod: 'PIX',
    status: 'COMPLETED',
  };
  const controller = {
    prisma: {
      platform: {
        findMany: async () => [
          { id: 'owner', tag: 'RENOVADA', ownerUserId: 'owner' },
        ],
      },
      communityLinkBinding: { findMany: async () => [] },
      transaction: {
        findMany: mock(async ({ where }: any) =>
          where?.status === 'REFUNDED' ? [] : [tx],
        ),
        count: async () => 1,
      },
      balanceLog: {
        findMany: async () => [],
        aggregate: async () => ({ _sum: { bookkeepingAmount: 0 } }),
      },
      withdrawRequest: { findMany: async () => [] },
    },
  };
  const result = await AdminController.prototype.getConsolidado.call(
    controller as any,
    '2026-10-01',
    '2026-10-31',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    '1',
  );
  expect(result.lucroSimpay).toBe(25);
  expect(result.lucroSimpayDetalhe.lucroSimpayTotal).toBe(25);
});

test('consolidated sales apply payment method before counting and pagination', async () => {
  const findMany = mock(async () => []);
  const count = mock(async () => 0);
  const controller = {
    prisma: {
      platform: {
        findMany: async () => [{ tag: 'RENOVADA', ownerUserId: 'owner' }],
      },
      transaction: { findMany, count },
    },
  };
  await AdminController.prototype.listConsolidadoTransacoes.call(
    controller as any,
    '1',
    '20',
    '2026-10-01',
    '2026-10-19',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'PIX',
  );
  expect(findMany.mock.calls[0][0].where.paymentMethod).toBe('PIX');
  expect(count.mock.calls[0][0].where.paymentMethod).toBe('PIX');
});

test('Grupo SIM platforms contribute their full net sales to monthly and consolidated owner transfers', async () => {
  const rows = [
    {
      id: 'atlas-sale',
      customerDocument: '123.456.789-01',
      userId: 'grupo-sim',
      amount: 100,
      netAmount: 80,
      acquirerFee: 2,
      createdAt: new Date('2026-10-05T12:00:00Z'),
      description: '[TENANT:ATLAS]',
      installments: 1,
      paymentMethod: 'PIX',
    },
    {
      id: 'areaflix-sale',
      customerDocument: '12345678901',
      userId: 'grupo-sim',
      amount: 200,
      netAmount: 150,
      acquirerFee: 3,
      createdAt: new Date('2026-10-06T12:00:00Z'),
      description: '[TENANT:AREAFLIX]',
      installments: 1,
      paymentMethod: 'PIX',
    },
    {
      id: 'shop-sale',
      customerDocument: null,
      userId: 'other-owner',
      amount: 50,
      netAmount: 45,
      acquirerFee: 1,
      createdAt: new Date('2026-10-07T12:00:00Z'),
      description: '[TENANT:SHOP]',
      installments: 1,
      paymentMethod: 'PIX',
    },
  ];
  const controller = {
    prisma: {
      platform: {
        findMany: async () => [
          { tag: 'ATLAS', ownerUserId: 'grupo-sim' },
          { tag: 'AREAFLIX', ownerUserId: 'grupo-sim' },
          { tag: 'SHOP', ownerUserId: 'other-owner' },
        ],
      },
      communityLinkBinding: { findMany: async () => [] },
      transaction: {
        findMany: async ({ where }: any) =>
          ['REFUNDED', 'CHARGEBACK'].includes(where.status) ? [] : rows,
      },
      balanceLog: {
        aggregate: async () => ({ _sum: { amount: 0 } }),
        findMany: async () => [],
      },
      withdrawRequest: { findMany: async () => [] },
    },
  };
  const consolidated = await AdminController.prototype.getConsolidado.call(
    controller as any,
    '2026-10-01',
    '2026-10-19',
  );
  const monthly = await AdminController.prototype.getRelatorioMensal.call(
    controller as any,
    '1',
    '2026-10-01',
    '2026-10-19',
  );
  expect(consolidated.totalTransacoes).toBe(3);
  expect(consolidated.customersCount).toBe(1);
  expect(consolidated.valorBruto).toBe(350);
  expect(consolidated.totalRepasseConsolidado).toBe(275);
  expect(consolidated.totalRepasseReal).toBe(275);
  expect(consolidated.lucroPlataformasSemRepasse).toBe(0);
  expect(consolidated.lucroSimpayConRepasse).toBe(consolidated.lucroSimpay);
  expect(consolidated.lucroTotalMaster).toBe(consolidated.lucroSimpay);
  expect(monthly.meses[0].totalRepassado).toBe(275);
});
