import { beforeEach, afterEach, expect, mock, test } from 'bun:test';
import { AdminController } from '../../../presentation/controllers/admin.controller';
import { PlatformReportProjectionsController } from '../platform-report-projections.controller';
import { PlatformAdministrationService } from '../platform-administration.service';
import { initializePlatformRegistryCache } from '../../module.registry';
import { matches } from './platform-query-fixture';

beforeEach(async () =>
  initializePlatformRegistryCache({
    platform: {
      findMany: async () => [{ tag: 'ATLAS', ownerUserId: 'owner' }],
    },
  } as any),
);
afterEach(async () =>
  initializePlatformRegistryCache({
    platform: { findMany: async () => [] },
  } as any),
);
function fixture() {
  const context = {
    id: 'p',
    tag: 'ATLAS',
    ownerUserId: 'owner',
    acquirer: 'DOM' as const,
  };
  const platform = {
    ...context,
    isActive: true,
    createdAt: new Date(0),
    owner: { isActive: true, cpf: '123', name: 'Owner' },
  };
  const rows = [
    {
      id: 'tx',
      userId: 'owner',
      amount: 123.45,
      netAmount: 100,
      domFee: 1,
      platformFee: 2,
      totalFee: 3,
      status: 'COMPLETED',
      description: 'Plano VM [TENANT:ATLAS]',
      platformTag: 'ATLAS',
      paymentMethod: 'PIX',
      customerEmail: 'buyer@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const link = {
    id: 'link',
    name: 'Plano',
    code: 'plan',
    amount: 12.34,
    frequencyType: 'MONTHLY',
    currentUses: 1,
    isActive: true,
  };
  const p: any = {
    platform: {
      findUnique: async () => platform,
      findMany: async () => [platform],
    },
    transaction: {
      findMany: mock(async ({ where, skip = 0, take }: any) =>
        rows
          .filter((row) => matches(row, where))
          .slice(skip, take ? skip + take : undefined),
      ),
      count: async ({ where }: any) =>
        rows.filter((row) => matches(row, where)).length,
    },
    pixCreditPlan: { count: async () => 2 },
    community: { findUnique: async () => null },
    externalPlatformUser: {
      findMany: async () => [
        { platform: 'atlas', wallet: { balance: 123.45, lockedBalance: 1.23 } },
      ],
    },
    subscriptionLink: { findMany: async () => [link] },
    communityLinkBinding: {
      findMany: async ({ include }: any) =>
        include
          ? [
              {
                subscriptionLink: link,
                community: {
                  id: 'community',
                  name: 'Grupo',
                  slug: 'grupo',
                  isActive: true,
                  accesses: [],
                },
              },
            ]
          : [],
    },
  };
  const alias = Object.assign(Object.create(AdminController.prototype), {
    prisma: p,
    paymentGateway: {},
    platformReporting: {},
  });
  return {
    p,
    platform,
    rows,
    context,
    alias,
    canonical: new PlatformReportProjectionsController(p, {} as any, {} as any),
    core: new PlatformAdministrationService(p, {} as any, {} as any),
  };
}
test('administrative platform listing and balances preserve actual persisted projections', async () => {
  const f = fixture();
  expect(await f.alias.listPlataformas()).toEqual(
    await f.core.listPlataformas(),
  );
  expect((await f.alias.listPlataformas()).data[0]).toMatchObject({
    ownerUserId: 'owner',
    plansCount: 2,
    transactionsCount: 1,
  });
  expect(await f.alias.getPlataformasSaldosResumo()).toEqual({
    resumo: [
      {
        platform: 'atlas',
        ownerUserId: 'owner',
        walletScope: 'platform',
        totalDisponivel: 123.45,
        totalBloqueado: 1.23,
        contas: 1,
      },
    ],
  });
});
test('administrative method distribution and Atlas breakdown match canonical amounts and decimal rates', async () => {
  const f = fixture();
  const old = await f.alias.getPlataformaDistribuicaoMetodo('ATLAS');
  const current = await f.canonical.paymentMethods({
    platformContext: f.context,
  });
  expect(current.total).toBe(old.total);
  expect(current.items).toEqual(
    old.items.map(({ valor, percentual, ...row }: any) => ({
      ...row,
      valorCents: Math.round(valor * 100),
      rate: percentual / 100,
    })),
  );
  const breakdown = await f.alias.getAtlasBreakdown();
  const result = await f.canonical.atlasProducts({
    platformContext: f.context,
  });
  expect(result.data.clientesUnicos).toBe(1);
  expect(result.data.hospedagem.receitaCents).toBe(
    Math.round(breakdown.hospedagem.receita * 100),
  );
  expect(result.data.hospedagem.quantidade).toBe(
    breakdown.hospedagem.quantidade,
  );
});
test('administrative community and transaction detail projections preserve counts and legacy units', async () => {
  const f = fixture();
  const old = await f.alias.listPlataformaComunidades('ATLAS');
  const current = await f.canonical.communities({ platformContext: f.context });
  expect(current.data[0].links[0].amountCents).toBe(
    Math.round(Number(old.data[0].links[0].amount) * 100),
  );
  const transactions = await f.alias.listPlataformaTransacoes('ATLAS');
  const details = await f.canonical.transactionDetails({
    platformContext: f.context,
  });
  expect(details.total).toBe(transactions.total);
  expect(details.data[0].valorBrutoCents).toBe(12345);
  expect(details.data[0].valorLiquidoCents).toBe(
    Math.round(transactions.data[0].valorLiquido * 100),
  );
  expect(details.data[0].taxas.totalCents).toBe(
    Math.round(transactions.data[0].taxas.total * 100),
  );
});
test('canonical administration excludes conflicting history and rejects transferred ownership', async () => {
  const f = fixture();
  f.rows.push({
    ...f.rows[0],
    id: 'mixed',
    amount: 500,
    description: '[TENANT:ATLAS]',
    platformTag: 'OTHER',
  });
  expect(
    (await f.canonical.paymentMethods({ platformContext: f.context })).total,
  ).toBe(1);
  expect(
    (await f.canonical.transactionDetails({ platformContext: f.context }))
      .total,
  ).toBe(1);
  f.platform.ownerUserId = 'transferred';
  await expect(
    f.canonical.paymentMethods({ platformContext: f.context }),
  ).rejects.toThrow('Contexto');
});
