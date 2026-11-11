import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { ClienteDashboardController } from '../../cliente/cliente-dashboard.controller';
import { ClienteDashboardService } from '../../cliente/services/cliente-dashboard.service';
import { PlatformReportProjectionsController } from '../platform-report-projections.controller';
import { initializePlatformRegistryCache } from '../../module.registry';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';
import { matches } from './platform-query-fixture';

beforeEach(async () => {
  await initializePlatformRegistryCache({
    platform: {
      findMany: async () => [{ tag: 'PAGATG', ownerUserId: 'owner' }],
    },
  } as any);
  await initializePlatformTaxasCache({
    platformTaxaOverride: {
      findMany: async () => [{ tag: 'GLOBAL', key: 'LIQUIDEZ', value: 1 }],
    },
  } as any);
});
afterEach(async () => {
  await initializePlatformRegistryCache({
    platform: { findMany: async () => [] },
  } as any);
  await initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as any);
});
function fixture() {
  const context = {
    id: 'p',
    tag: 'SHOP',
    ownerUserId: 'owner',
    acquirer: 'DOM' as const,
  };
  const platform = {
    ...context,
    isActive: true,
    owner: { isActive: true, isPurged: false },
  };
  const rows = [
    {
      userId: 'owner',
      status: 'COMPLETED',
      netAmount: 12.34,
      description: '[TENANT:SHOP] [CPF_DONO:12345678901] Maquineta',
      platformTag: 'SHOP',
      createdAt: new Date(),
    },
    {
      userId: 'owner',
      status: 'REFUNDED',
      netAmount: 2.34,
      description: '[TENANT:SHOP] [CPF_DONO:12345678901]',
      platformTag: 'SHOP',
      createdAt: new Date(),
    },
  ];
  const p: any = {
    platform: { findUnique: async () => platform },
    user: { findUnique: async () => ({ id: 'owner', cpf: '12345678901' }) },
    wallet: { findUnique: async () => ({ balance: 100, lockedBalance: 10 }) },
    transaction: {
      findMany: mock(async ({ where }: any) =>
        rows.filter((row) => matches(row, where)),
      ),
      aggregate: async ({ where }: any) => {
        const selected = rows.filter((row) => matches(row, where));
        return {
          _count: { id: selected.length },
          _sum: {
            netAmount: selected.reduce(
              (total, row) => total + row.netAmount,
              0,
            ),
          },
        };
      },
    },
    withdrawRequest: { findMany: async () => [{ createdAt: new Date() }] },
  };
  return {
    context,
    platform,
    p,
    rows,
    alias: new ClienteDashboardController(new ClienteDashboardService(p)),
    canonical: new PlatformReportProjectionsController(p, {} as any),
  };
}
test('customer alias and product report share projection with preserved reais/cents and count units', async () => {
  const f = fixture();
  const old = await f.alias.getDashboard(
    { sub: 'owner', email: 'owner@example.com', role: 'USER' },
    'hoje',
  );
  const current = await f.canonical.customer(
    { platformContext: f.context },
    'hoje',
  );
  expect(current.summary.ownerWalletAvailableBalanceCents).toBe(
    old.summary.availableBalance * 100,
  );
  expect(current.profit.total).toBe(Math.round(old.profit.total * 100));
  expect(current.profit.maquinetas).toBe(1234);
  expect(current.profit.offers).toBe(0);
  expect(current.refunds).toEqual({
    count: old.estornos.quantidade,
    netAmountCents: 234,
  });
  expect(current.withdrawals).toEqual(old.withdrawals);
  expect(current.selected.withdrawals).toBe(old.selected.withdrawals);
  expect(current.profit.charts.last30Days).toHaveLength(30);
  expect(current.profit.charts.annualByMonth).toHaveLength(12);
});
test('canonical customer report excludes ambiguous, untagged and other-product history without inheriting CPF pool selection', async () => {
  const f = fixture();
  f.rows.push(
    {
      ...f.rows[0],
      netAmount: 500,
      description: '[TENANT:SHOP] [CPF_DONO:12345678901]',
      platformTag: 'OTHER',
    },
    {
      ...f.rows[0],
      netAmount: 600,
      description: '[CPF_DONO:12345678901]',
      platformTag: null,
    },
    {
      ...f.rows[0],
      netAmount: 700,
      description: '[TENANT:OTHER] [CPF_DONO:12345678901]',
      platformTag: 'OTHER',
    },
  );
  const result = await f.canonical.customer({ platformContext: f.context });
  expect(result.profit.total).toBe(1234);
  expect(result.profit.charts.last30Days.at(-1).value).toBe(1234);
  expect(result.refunds.count).toBe(1);
});
test('customer product report blocks invalid period and transferred owner before financial queries', async () => {
  const f = fixture();
  await expect(
    f.canonical.customer({ platformContext: f.context }, 'bad'),
  ).rejects.toThrow('Período inválido');
  f.platform.ownerUserId = 'new-owner';
  await expect(
    f.canonical.customer({ platformContext: f.context }),
  ).rejects.toThrow('Contexto da plataforma mudou');
  expect(f.p.transaction.findMany).not.toHaveBeenCalled();
});
