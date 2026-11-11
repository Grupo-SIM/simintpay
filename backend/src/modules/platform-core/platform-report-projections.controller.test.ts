import { beforeAll, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformReportProjectionsController } from './platform-report-projections.controller';
import { AdminController } from '../../presentation/controllers/admin.controller';
import { initializePlatformTaxasCache } from '../platform-taxas/platform-taxas.store';
beforeAll(async () =>
  initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as any),
);
function fixture() {
  const context = {
    id: 'platform',
    tag: 'BOSQUE',
    ownerUserId: 'owner',
    acquirer: 'DOM' as const,
  };
  const platform = { ...context, isActive: true, owner: { isActive: true } };
  const prisma: any = {
    platform: { findUnique: mock(async () => platform) },
    transaction: {
      findMany: mock(async () => [
        {
          id: 'tx',
          amount: new Prisma.Decimal(100),
          netAmount: new Prisma.Decimal(90),
          domFee: new Prisma.Decimal(2),
          platformFee: new Prisma.Decimal(8),
          description: '[TENANT:BOSQUE]',
          paymentMethod: 'PIX',
          installments: 1,
          createdAt: new Date('2026-09-20T12:00:00Z'),
          acquirer: 'DOM',
        },
      ]),
    },
  };
  const gateway = {
    listDomTransactions: mock(async () => {
      throw new Error('Report cannot call remote gateway');
    }),
  };
  const alias = Object.assign(Object.create(AdminController.prototype), {
    prisma,
    paymentGateway: gateway,
  });
  return {
    prisma,
    context,
    platform,
    gateway,
    alias,
    controller: new PlatformReportProjectionsController(prisma, gateway as any),
  };
}
test('consolidated alias and canonical share local snapshot; cents and counts preserve meaning', async () => {
  const { alias, controller, context, gateway } = fixture();
  const legacy = await alias.getPlataformaConsolidado(
    context.tag,
    '2026-09-01',
    '2026-09-30',
  );
  const canonical = await controller.consolidated(
    { platformContext: context },
    '2026-09-01',
    '2026-09-30',
  );
  for (const [key, value] of Object.entries(legacy)) {
    expect(
      canonical.data[
        typeof value === 'number' &&
        !['qtdTransacoes', 'qtdMaquineta'].includes(key)
          ? `${key}Cents`
          : key
      ],
    ).toEqual(
      typeof value === 'number' &&
        !['qtdTransacoes', 'qtdMaquineta'].includes(key)
        ? Math.round(value * 100)
        : value,
    );
  }
  expect(gateway.listDomTransactions).not.toHaveBeenCalled();
});
test('canonical report validates interval and owner context before reading ledger', async () => {
  const { controller, context, platform, prisma } = fixture();
  await expect(
    controller.consolidated({ platformContext: context }, '2026-02-30'),
  ).rejects.toThrow('Data inválida');
  platform.ownerUserId = 'new-owner';
  await expect(
    controller.consolidated({ platformContext: context }, '2026-09-01'),
  ).rejects.toThrow('Contexto da plataforma mudou');
  expect(prisma.transaction.findMany).not.toHaveBeenCalled();
});
