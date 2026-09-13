// `uuid` (v13) é ESM-only e o jest não o transforma por padrão.
jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
  v5: () => 'test-uuid',
  MAX: '',
  NIL: '',
}));

jest.mock('../../modules/platform-taxas/platform-taxas.store', () => ({
  getPlatformTaxaEffective: (_tag: string, _key: string, fallback: number) => fallback,
  invalidatePlatformTaxaCache: jest.fn(),
  buildClientTaxaTag: (email: string) => `CLIENT:${email}`,
  canonicalPlatformTaxaTag: (tag: string) => tag,
}));

import { AdminController } from './admin.controller';

describe('AdminController.getPlataformaConsolidado', () => {
  it('separa taxa percentual e taxa por transação como na tabela', async () => {
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

    const result = await (AdminController.prototype as any).getPlataformaConsolidado.call(
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
      taxaSimIntPctBruta: -3.92,
      taxaSimIntFixa: 4,
      taxaSimIntPctNet: -3.93,
      totalTaxasSimInt: 0.07,
      totalRepasse: 0.92,
    });

    expect(result.taxaSimIntPctBruta + result.taxaSimIntFixa).toBeCloseTo(0.08, 2);
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

    const result = await (AdminController.prototype as any).getPlataformaConsolidado.call(
      ctx,
      'RENOVADA',
      '2026-06-01',
      '2026-06-30',
    );

    expect(result.taxaDomPct).toBe(0);
  });

  it('usa somente a taxa DOM efetiva no PIX standalone de comunidade', async () => {
    const amount = 59.9;
    // Sete pedidos já possuem réplica Transaction; o oitavo existe somente
    // como SubscriptionLinkOrder e ainda precisa entrar nos cards.
    const transactions = Array.from({ length: 7 }, (_, index) => ({
      amount,
      paymentMethod: 'PIX',
      installments: 1,
      createdAt: new Date(`2026-08-${String(index + 1).padStart(2, '0')}T07:02:00Z`),
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
      createdAt: new Date(`2026-08-${String(index + 1).padStart(2, '0')}T07:02:00Z`),
    }));
    const ctx = {
      findLocalPlatformReportTransactions: jest.fn().mockResolvedValue(transactions),
      prisma: {
        community: { findUnique: jest.fn().mockResolvedValue({ id: 'community-1' }) },
        communityLinkBinding: {
          findMany: jest.fn().mockResolvedValue([{
            subscriptionLinkId: 'link-1',
            subscriptionLink: { isStandalone: true },
          }]),
        },
        subscriptionLinkOrder: {
          findMany: jest.fn().mockResolvedValue(orders),
        },
      },
    } as any;

    const result = await (AdminController.prototype as any).getPlataformaConsolidado.call(
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
      subscriptionLink: { name: 'Combo de Comunidades', userId: 'owner-1', isStandalone: true },
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
        community: { findUnique: jest.fn().mockResolvedValue({ id: 'community-1' }) },
        communityLinkBinding: {
          findMany: jest.fn().mockResolvedValue([{ subscriptionLinkId: 'link-1' }]),
        },
        subscriptionLinkOrder: { findMany: jest.fn().mockResolvedValue([order]) },
        transaction: { findMany: jest.fn().mockResolvedValue([transaction]) },
      },
    } as any;

    const result = await (AdminController.prototype as any).listPlataformaTransacoes.call(
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
