import { beforeEach, expect, test } from 'bun:test';
import { PlatformAdministrationService } from '../platform-administration.service';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';

beforeEach(async () => {
  await initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as never);
});

function fixture(merchantAmountCents = 10000, includeLegacy = false) {
  const createdAt = new Date('2026-10-21T12:00:00Z');
  const rows: any[] = [
    {
      id: 'delivery',
      userId: 'seller',
      amount: 105.37,
      netAmount: merchantAmountCents / 100,
      totalFee: (10537 - merchantAmountCents) / 100,
      platformFee: (10537 - merchantAmountCents) / 100,
      acquirerFee: 0,
      status: 'COMPLETED',
      description: '[TENANT:ZERO-GRAU]',
      paymentMethod: 'PIX',
      installments: 1,
      createdAt,
      financialSnapshot: {
        contract: 'SIM_DELIVERY_ALLOCATION_V1',
        totalAmountCents: 10537,
        merchantAmountCents,
        platformFeeCents: 10537 - merchantAmountCents,
      },
    },
  ];
  if (includeLegacy)
    rows.push({ ...rows[0], id: 'legacy', financialSnapshot: null });
  const p: any = {
    platform: {
      findUnique: async () => ({
        id: 'p',
        tag: 'ZERO-GRAU',
        ownerUserId: 'owner',
      }),
    },
    transaction: { count: async () => rows.length, findMany: async () => rows },
    community: { findUnique: async () => null },
  };
  return new PlatformAdministrationService(p, {} as never, {} as never);
}

test('administrative transaction details preserve full Delivery proceeds without inferred fees', async () => {
  const result = await fixture().listPlataformaTransacoes('ZERO-GRAU');
  expect(result.data[0]).toMatchObject({
    valorBruto: 105.37,
    valorLiquido: 100,
    taxaSimIntPay: 5.37,
    taxaFixa: 0,
    taxaCashback: 0,
    taxaServico: 0,
    taxaDom: 0,
    lucroAdmin: 5.37,
    lucroPrejuizo: 5.37,
    taxas: { total: 5.37, plataforma: 5.37, dom: 0 },
  });
});

test('consolidated report agrees with wallet allocation and excludes phantom transaction costs', async () => {
  const result = await fixture().getPlataformaConsolidado(
    'ZERO-GRAU',
    '2026-10-01',
  );
  expect(result).toMatchObject({
    receitaTotal: 105.37,
    totalRepasse: 100,
    taxaSimIntFixa: 0,
    taxaDomFixa: 0,
    taxaDomCashback: 0,
    totalTaxasDom: 0,
    totalTaxasSimInt: 5.37,
  });
});

test('zero merchant proceeds remain zero in details and consolidated report', async () => {
  const service = fixture(0);
  expect(
    (await service.listPlataformaTransacoes('ZERO-GRAU')).data[0].valorLiquido,
  ).toBe(0);
  expect(
    await service.getPlataformaConsolidado('ZERO-GRAU', '2026-10-01'),
  ).toMatchObject({ totalRepasse: 0, totalTaxasSimInt: 105.37 });
});

test('historical rows retain their previous report rules beside new Delivery allocations', async () => {
  const service = fixture(10000, true);
  const details = await service.listPlataformaTransacoes('ZERO-GRAU');
  expect(details.data[0].valorLiquido).toBe(100);
  expect(details.data[1].valorLiquido).toBeLessThan(100);
});
