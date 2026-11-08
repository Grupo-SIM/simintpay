import { initializePlatformRegistryCache } from '../../modules/module.registry';
beforeEach(async () => {
  await initializePlatformRegistryCache({
    platform: {
      findMany: async () =>
        ['ATLAS', 'RENOVADA', 'BOSQUE'].map((tag) => ({
          tag,
          ownerUserId: tag.toLowerCase() + '-1',
        })),
    },
  } as never);
});
// `uuid` (v13) é ESM-only e o jest não o transforma por padrão.
jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
  v5: () => 'test-uuid',
  MAX: '',
  NIL: '',
}));

jest.mock('../../modules/platform-taxas/platform-taxas.store', () => ({
  getPlatformTaxaEffective: (_tag: string, _key: string, fallback: number) =>
    fallback,
  domCashbackReais: () => 3,
  // Synced acquirer schedule stand-in: [ratePpm, fixedCents] per METHOD/CHANNEL/installments.
  syncedAcquirerCostReais: (
    method: string,
    channel: string,
    installments: number,
    amount: number,
  ) => {
    const schedule: Record<string, [number, number]> = {
      'PIX/ONLINE/1': [9_800, 0],
      'BOLETO/ONLINE/1': [0, 449],
      'DEBIT_CARD/ONLINE/1': [34_900, 100],
      'CREDIT_CARD/ONLINE/1': [39_900, 0],
      'PIX/POS/1': [10_000, 0],
      'DEBIT_CARD/POS/1': [34_900, 100],
      'CREDIT_CARD/POS/1': [34_900, 100],
    };
    const [ratePpm, fixedCents] = schedule[
      `${method}/${channel}/${installments}`
    ] ?? [0, 0];
    const pct = (amount * ratePpm) / 1_000_000;
    return { pct, fixa: fixedCents / 100, total: pct + fixedCents / 100 };
  },
  resolveWithdrawalFixedFee: () => 3.5,
  invalidatePlatformTaxaCache: jest.fn(),
  buildClientTaxaTag: (email: string) => `CLIENT:${email}`,
  canonicalPlatformTaxaTag: (tag: string) => tag,
}));

import { AdminController as HttpAdminController } from './admin.controller';
import { PlatformAdministrationService as AdminController } from '../../modules/platform-core/platform-administration.service';

describe('AdminController.getPlataformaConsolidado', () => {
  it('separa taxa percentual Sim Int Pay da taxa fixa e dos custos DOM', async () => {
    const ctx = {
      findLocalPlatformReportTransactions: jest.fn().mockResolvedValue([
        {
          amount: 1,
          paymentMethod: 'PIX',
          installments: 1,
          createdAt: new Date('2026-09-12T12:00:00Z'),
          description: '[TENANT:RENOVADA]',
          netAmount: 0.92,
          domFee: 0.01,
          platformFee: 0.08,
          cardBrand: null,
          acquirer: 'DOM',
        },
      ]),
      prisma: {
        community: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    } as any;

    const result = await (
      AdminController.prototype as any
    ).getPlataformaConsolidado.call(
      ctx,
      'RENOVADA',
      '2026-09-01',
      '2026-09-30',
    );

    expect(result).toMatchObject({
      taxaDomPct: 0.01,
      taxaDomFixa: 1,
      taxaDomCashback: 3,
      totalTaxasDom: 4.01,
      taxaSimIntPctBruta: 0.08,
      taxaSimIntFixa: 4,
      taxaSimIntPctNet: 0.07,
      totalTaxasSimInt: 4.08,
      totalRepasse: -3.08,
    });

    expect(result.taxaSimIntPctBruta + result.taxaSimIntFixa).toBeCloseTo(
      4.08,
      2,
    );
  });

  it('separa POS das taxas online e fecha receita menos repasse com todas as taxas Sim Int Pay', async () => {
    const createdAt = new Date('2026-09-08T20:00:00Z');
    const ctx = {
      findLocalPlatformReportTransactions: jest.fn().mockResolvedValue([
        {
          amount: 52,
          paymentMethod: 'PIX',
          installments: 1,
          description: 'dizimo',
          netAmount: 47.83,
          domFee: 0.51,
          platformFee: 4.17,
          createdAt,
          cardBrand: null,
          acquirer: 'DOM',
        },
        {
          amount: 110,
          paymentMethod: 'PIX',
          installments: 1,
          description: 'dizimo',
          netAmount: 101.18,
          domFee: 1.08,
          platformFee: 8.82,
          createdAt,
          cardBrand: null,
          acquirer: 'DOM',
        },
        {
          amount: 55,
          paymentMethod: 'PIX',
          installments: 1,
          description: 'primicia',
          netAmount: 50.59,
          domFee: 0.54,
          platformFee: 4.41,
          createdAt,
          cardBrand: null,
          acquirer: 'DOM',
        },
        {
          amount: 163,
          paymentMethod: 'PIX',
          installments: 1,
          description: 'dizimo',
          netAmount: 149.93,
          domFee: 1.6,
          platformFee: 13.07,
          createdAt,
          cardBrand: null,
          acquirer: 'DOM',
        },
        {
          amount: 28.99,
          paymentMethod: 'PIX',
          installments: 1,
          description: 'Maquineta - Terminal: pix-1',
          netAmount: 26.38,
          domFee: 0.29,
          platformFee: 2.61,
          createdAt,
          cardBrand: null,
          acquirer: 'DOM',
        },
        {
          amount: 20,
          paymentMethod: 'PIX',
          installments: 1,
          description: 'Maquineta - Terminal: pix-2',
          netAmount: 18.2,
          domFee: 0.2,
          platformFee: 1.8,
          createdAt,
          cardBrand: null,
          acquirer: 'DOM',
        },
        {
          amount: 30,
          paymentMethod: 'CREDIT_CARD',
          installments: 1,
          description: 'Maquineta - Terminal: card-1',
          netAmount: 27.3,
          domFee: 2.05,
          platformFee: 2.7,
          createdAt,
          cardBrand: 'VISA',
          acquirer: 'DOM',
        },
      ]),
      prisma: {
        community: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    } as any;

    const result = await (
      AdminController.prototype as any
    ).getPlataformaConsolidado.call(
      ctx,
      'RENOVADA',
      '2026-09-01',
      '2026-09-30',
    );

    expect(result).toMatchObject({
      // Somente as quatro vendas online.
      taxaDomPct: 3.73,
      taxaDomFixa: 4,
      taxaDomCashback: 12,
      totalTaxasDom: 19.73,
      taxaSimIntPctBruta: 30.47,
      taxaSimIntFixa: 16,
      totalTaxasSimInt: 46.47,
      // POS fica integralmente na seção própria.
      maqBruto: 78.99,
      maqDom: 2.54,
      maqSimInt: 7.11,
      // Receita − repasse = taxas online + POS.
      receitaTotal: 458.99,
      totalRepasse: 405.41,
      taxaSimIntPctGeral: 37.58,
      totalTaxasSimIntGeral: 53.58,
      totalTaxasDomGeral: 22.27,
    });
    expect(result.receitaTotal - result.totalRepasse).toBeCloseTo(
      result.totalTaxasSimIntGeral,
      2,
    );
  });

  it('não estima MDR atual quando a venda não tem taxa DOM persistida', async () => {
    const ctx = {
      findLocalPlatformReportTransactions: jest.fn().mockResolvedValue([
        {
          amount: 19.9,
          paymentMethod: 'PIX',
          installments: 1,
          createdAt: new Date('2026-06-07T03:15:00Z'),
          description: '[TENANT:RENOVADA]',
          netAmount: 15.9,
          domFee: 0,
          platformFee: 4,
          cardBrand: null,
          acquirer: 'DOM',
        },
      ]),
      prisma: {
        community: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    } as any;

    const result = await (
      AdminController.prototype as any
    ).getPlataformaConsolidado.call(
      ctx,
      'RENOVADA',
      '2026-06-01',
      '2026-06-30',
    );

    expect(result.taxaDomPct).toBe(0);
  });

  it('não transfere R$ 4 da DOM para a taxa por transação da Revalida', async () => {
    const ctx = {
      findLocalPlatformReportTransactions: jest.fn().mockResolvedValue([
        {
          amount: 1,
          paymentMethod: 'PIX',
          installments: 1,
          createdAt: new Date('2026-04-01T17:13:00Z'),
          description: 'Revalida',
          netAmount: -0.05,
          domFee: 0.01,
          platformFee: 1.01,
          cardBrand: null,
          acquirer: 'DOM',
        },
        {
          amount: 1,
          paymentMethod: 'PIX',
          installments: 1,
          createdAt: new Date('2026-02-26T17:43:00Z'),
          description: 'Revalida',
          netAmount: 0,
          domFee: 0.04,
          platformFee: 1.04,
          cardBrand: null,
          acquirer: 'DOM',
        },
      ]),
      prisma: {
        community: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    } as any;

    const result = await (
      AdminController.prototype as any
    ).getPlataformaConsolidado.call(
      ctx,
      'REVALIDA',
      '2026-02-01',
      '2026-04-30',
      'PIX',
    );

    expect(result).toMatchObject({
      taxaDomPct: 0.05,
      taxaDomFixa: 2,
      taxaDomCashback: 6,
      totalTaxasDom: 8.05,
      taxaSimIntPctBruta: 2.05,
      taxaSimIntFixa: 0,
      taxaSimIntPctNet: -6,
      totalTaxasSimInt: 2.05,
      totalRepasse: -0.05,
    });
  });

  it('não aplica taxa fixa Sim Int Pay antes da vigência da plataforma', async () => {
    const ctx = {
      findLocalPlatformReportTransactions: jest.fn().mockResolvedValue([
        {
          amount: 1,
          paymentMethod: 'PIX',
          installments: 1,
          createdAt: new Date('2026-04-01T17:13:00Z'),
          description: '[TENANT:RENOVADA]',
          netAmount: 0.92,
          domFee: 0.01,
          platformFee: 0.08,
          cardBrand: null,
          acquirer: 'DOM',
        },
      ]),
      prisma: {
        community: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    } as any;

    const result = await (
      AdminController.prototype as any
    ).getPlataformaConsolidado.call(
      ctx,
      'RENOVADA',
      '2026-04-01',
      '2026-04-30',
      'PIX',
    );

    expect(result).toMatchObject({
      taxaSimIntPctBruta: 0.08,
      taxaSimIntFixa: 0,
      taxaSimIntPctNet: -3.93,
      totalTaxasSimInt: 0.08,
    });
  });

  it('reconstitui as taxas do cartão Teron quando a cobrança de workspace não gravou snapshot', async () => {
    const ctx = {
      findLocalPlatformReportTransactions: jest.fn().mockResolvedValue([
        {
          amount: 1,
          paymentMethod: 'CREDIT_CARD',
          installments: 1,
          createdAt: new Date('2026-08-17T12:00:00Z'),
          description: 'Teron workspace (1 integrante) [TENANT:TERON]',
          platformTag: 'TERON',
          netAmount: 1,
          domFee: 0,
          platformFee: 0,
          cardBrand: null,
          acquirer: 'DOM',
        },
      ]),
      prisma: {
        community: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    } as any;

    const result = await (
      AdminController.prototype as any
    ).getPlataformaConsolidado.call(
      ctx,
      'TERON',
      '2026-08-01',
      '2026-08-31',
      'CREDIT_CARD',
    );

    expect(result).toMatchObject({
      taxaDomPct: 0.04,
      taxaDomFixa: 1,
      taxaDomCashback: 3,
      totalTaxasDom: 4.04,
      taxaSimIntPctBruta: 4.09,
      taxaSimIntFixa: 4,
      taxaSimIntPctNet: 4.05,
      totalTaxasSimInt: 8.09,
    });
  });

  it('usa somente a taxa DOM efetiva no PIX standalone de comunidade', async () => {
    const amount = 59.9;
    // Sete pedidos já possuem réplica Transaction; o oitavo existe somente
    // como SubscriptionLinkOrder e ainda precisa entrar nos cards.
    const transactions = Array.from({ length: 7 }, (_, index) => ({
      amount,
      paymentMethod: 'PIX',
      installments: 1,
      createdAt: new Date(
        `2026-08-${String(index + 1).padStart(2, '0')}T07:02:00Z`,
      ),
      description: `[TENANT:COMBO-DE-COMUNIDADES] subOrder=order-${index + 1}`,
      netAmount: 54.51,
      domFee: 0,
      platformFee: 0,
      cardBrand: null,
      acquirer: 'DOM',
    }));
    const orders = Array.from({ length: 8 }, (_, index) => ({
      id: `order-${index + 1}`,
      subscriptionLinkId: 'link-1',
      amountCharged: amount,
      platformFeeAmount: 0,
      paymentMethod: 'PIX',
      createdAt: new Date(
        `2026-08-${String(index + 1).padStart(2, '0')}T07:02:00Z`,
      ),
    }));
    const ctx = {
      findLocalPlatformReportTransactions: jest
        .fn()
        .mockResolvedValue(transactions),
      prisma: {
        community: {
          findUnique: jest.fn().mockResolvedValue({ id: 'community-1' }),
        },
        communityLinkBinding: {
          findMany: jest.fn().mockResolvedValue([
            {
              subscriptionLinkId: 'link-1',
              subscriptionLink: { isStandalone: true },
            },
          ]),
        },
        subscriptionLinkOrder: {
          findMany: jest.fn().mockResolvedValue(orders),
        },
      },
    } as any;

    const result = await (
      AdminController.prototype as any
    ).getPlataformaConsolidado.call(
      ctx,
      'COMBO-DE-COMUNIDADES',
      '2026-07-01',
      '2026-08-31',
      'PIX',
    );

    expect(result.qtdTransacoes).toBe(8);
    expect(result.taxaSimIntPctBruta).toBe(0);
    expect(result.taxaSimIntFixa).toBe(0);
    expect(result.taxaSimIntPctNet).toBe(-12.72);
    expect(result.taxaDomPct).toBe(4.72);
    expect(result.taxaDomFixa).toBe(8);
    expect(result.taxaDomCashback).toBe(0);
    expect(result.totalTaxasDom).toBe(12.72);
    expect(result.receitaTotal).toBe(479.2);
    // Repasse desconta somente a taxa Sim Int Pay. Com a taxa zerada, a
    // plataforma absorve os R$12,72 de custos DOM e repassa o bruto integral.
    expect(result.totalRepasse).toBe(479.2);
  });
});

describe('AdminController.listPlataformaTransacoes — comunidade standalone', () => {
  it('mantém o repasse bruto quando a taxa Sim Int Pay é zero', async () => {
    const createdAt = new Date('2026-08-23T07:02:00Z');
    const order = {
      id: 'order-1',
      amountCharged: 59.9,
      platformFeeAmount: 0,
      paymentMethod: 'PIX',
      createdAt,
      updatedAt: createdAt,
      customerName: null,
      customerEmail: null,
      customerDocument: null,
      subscriptionLink: {
        name: 'Combo de Comunidades',
        userId: 'owner-1',
        isStandalone: true,
      },
    };
    const transaction = {
      id: 'tx-1',
      amount: 59.9,
      status: 'COMPLETED',
      paymentMethod: 'PIX',
      installments: 1,
      description: '[TENANT:COMBO-DE-COMUNIDADES] subOrder=order-1',
      netAmount: 54.51,
      totalFee: 5.39,
      domFee: 0,
      platformFee: 0,
      customerName: null,
      customerEmail: null,
      customerDocument: null,
      createdAt,
      updatedAt: createdAt,
    };
    const ctx = {
      prisma: {
        community: {
          findUnique: jest.fn().mockResolvedValue({ id: 'community-1' }),
        },
        communityLinkBinding: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ subscriptionLinkId: 'link-1' }]),
        },
        subscriptionLinkOrder: {
          findMany: jest.fn().mockResolvedValue([order]),
        },
        transaction: { findMany: jest.fn().mockResolvedValue([transaction]) },
      },
    } as any;

    const result = await (
      AdminController.prototype as any
    ).listPlataformaTransacoes.call(
      ctx,
      'COMBO-DE-COMUNIDADES',
      '1',
      '20',
      undefined,
      '2026-07-01',
      '2026-08-31',
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      valorBruto: 59.9,
      valorLiquido: 59.9,
      taxaDom: 0.59,
      taxaFixa: 1,
      taxaCashback: 0,
      taxaSimIntPay: 0,
      taxaServico: 0,
      lucroPrejuizo: -1.59,
      taxas: { total: 1.59, dom: 1.59, plataforma: 0 },
    });
  });
});

describe('AdminController.listPlataformaTransacoes — maquineta', () => {
  it('não aplica taxas online nem cashback às linhas POS', async () => {
    const createdAt = new Date('2026-09-08T20:00:00Z');
    const transactions = [
      {
        id: 'pix-pos',
        amount: 28.99,
        netAmount: 26.38,
        status: 'COMPLETED',
        paymentMethod: 'PIX',
        installments: 1,
        description: 'Maquineta - Terminal: pix-1',
        totalFee: 0,
        domFee: 0.29,
        platformFee: 2.61,
        cardBrand: null,
        customerName: null,
        customerEmail: null,
        customerDocument: null,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'card-pos',
        amount: 30,
        netAmount: 27.3,
        status: 'COMPLETED',
        paymentMethod: 'CREDIT_CARD',
        installments: 1,
        description: 'Maquineta - Terminal: card-1',
        totalFee: 0,
        domFee: 2.05,
        platformFee: 2.7,
        cardBrand: 'VISA',
        customerName: null,
        customerEmail: null,
        customerDocument: null,
        createdAt,
        updatedAt: createdAt,
      },
    ];
    const ctx = {
      prisma: {
        transaction: {
          count: jest.fn().mockResolvedValue(transactions.length),
          findMany: jest.fn().mockResolvedValue(transactions),
        },
      },
      getPlatformTransactionScope: jest.fn().mockResolvedValue({
        OR: [{ userId: { in: ['renovada-1'] } }],
      }),
    } as any;

    const result = await (
      AdminController.prototype as any
    ).listPlataformaTransacoes.call(
      ctx,
      'RENOVADA',
      '1',
      '20',
      undefined,
      '2026-09-01',
      '2026-09-30',
    );

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      id: 'pix-pos',
      valorLiquido: 26.38,
      taxaDom: 0.29,
      taxaFixa: 0,
      taxaCashback: 0,
      taxaServico: 0,
      taxas: { dom: 0.29, plataforma: 2.61, total: 2.9 },
    });
    expect(result.data[1]).toMatchObject({
      id: 'card-pos',
      valorLiquido: 27.3,
      taxaDom: 1.05,
      taxaFixa: 1,
      taxaCashback: 0,
      taxaServico: 0,
      taxas: { dom: 2.05, plataforma: 2.7, total: 4.75 },
    });
  });
});

describe('AdminController.getAtlasConsolidado', () => {
  it('filtra platformTag ATLAS sem incluir outras plataformas do mesmo dono', async () => {
    const ctx = {
      prisma: {
        platform: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ tag: 'ATLAS', ownerUserId: 'atlas-1' }),
          findFirst: jest.fn().mockResolvedValue({ ownerUserId: 'atlas-1' }),
        },
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'atlas-1' }) },
      },
    } as any;

    const scope = await (
      AdminController.prototype as any
    ).getPlatformTransactionScope.call(ctx, 'ATLAS');

    expect(scope).toEqual({ platformTag: 'ATLAS' });
  });

  it('reutiliza o cálculo comum dos cards financeiros', async () => {
    const previousAtlasHost = process.env.ATLAS_HOSTING_URL;
    delete process.env.ATLAS_HOSTING_URL;

    try {
      const ctx = {
        prisma: {
          platform: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ tag: 'ATLAS', ownerUserId: 'atlas-1' }),
            findFirst: jest.fn().mockResolvedValue({ ownerUserId: 'atlas-1' }),
          },
          user: { findFirst: jest.fn().mockResolvedValue({ id: 'atlas-1' }) },
          transaction: {
            count: jest.fn().mockResolvedValue(0),
          },
        },
        getPlataformaConsolidado: jest.fn().mockResolvedValue({
          taxaDomPct: 0.98,
          taxaDomFixa: 1,
          taxaDomCashback: 3,
          totalTaxasDom: 4.98,
          taxaSimIntPctBruta: 10.01,
          taxaSimIntPctNet: 5.03,
          taxaSimIntFixa: 0,
          totalTaxasSimInt: 10.01,
          receitaTotal: 100,
          totalRepasse: 89.99,
          qtdTransacoes: 1,
        }),
      } as any;

      const result = await (
        HttpAdminController.prototype as any
      ).getAtlasConsolidado.call(ctx, '2026-09-01', '2026-09-30');

      expect(result).toMatchObject({
        receitaTotalAtlas: 100,
        taxaMDRDom: 0.98,
        totalRepasse: 89.99,
      });
      expect(result.totalTaxasSimInt).toBeCloseTo(10.01, 2);
      expect(ctx.getPlataformaConsolidado).toHaveBeenCalledWith(
        'ATLAS',
        '2026-09-01',
        '2026-09-30',
        undefined,
        true,
      );
    } finally {
      if (previousAtlasHost === undefined) delete process.env.ATLAS_HOSTING_URL;
      else process.env.ATLAS_HOSTING_URL = previousAtlasHost;
    }
  });
});
