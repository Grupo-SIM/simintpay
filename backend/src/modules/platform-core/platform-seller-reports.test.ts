import { expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformSellerReports } from './platform-seller-reports';
import { PlatformDashboardController } from '../renovada/controllers/renovada-dashboard.controller';
import { PlatformReportProjectionsController } from './platform-report-projections.controller';
function fixture() {
  const context = {
    id: 'p',
    tag: 'SHOP',
    ownerUserId: 'owner',
    acquirer: 'DOM' as const,
  };
  const platform = { ...context, isActive: true, owner: { isActive: true } };
  const prisma: any = {
    $queryRaw: async () => [
      {
        userId: 'seller',
        platformTag: 'SHOP',
        nature: 'sale',
        balance: new Prisma.Decimal('0.29'),
        locked: new Prisma.Decimal('0.01'),
        rowCount: 1n,
        walletBalance: new Prisma.Decimal('0.29'),
        walletLocked: new Prisma.Decimal('0.01'),
      },
    ],
    community: { findUnique: async () => null },
    platform: { findUnique: mock(async () => platform) },
    externalPlatformUser: {
      count: async () => 1,
      findMany: mock(async () => [
        {
          userId: 'seller',
          name: 'Seller',
          cpf: '123',
          user: { email: 'seller@example.com' },
          wallet: { balance: 0.29, lockedBalance: 0.01 },
          createdAt: new Date(0),
        },
      ]),
    },
  };
  return { context, platform, prisma };
}
test('generic seller listing alias and canonical share scope and monetary units', async () => {
  const { context, prisma } = fixture();
  const alias = new PlatformDashboardController({} as any, prisma, {} as any);
  const canonical = new PlatformReportProjectionsController(
    prisma,
    {} as any,
    {} as any,
  );
  const old = await alias.getActiveSellers(
    'SHOP',
    '1',
    '20',
    'true',
    'carteiras',
  );
  const current = await canonical.sellers({ platformContext: context });
  expect(current.data[0].balanceCents).toBe(29);
  expect(current.data[0].lockedBalanceCents).toBe(1);
  expect(current.total).toBe(old.total);
  expect(current.data[0].email).toBe(old.data[0].email);
  expect(
    prisma.externalPlatformUser.findMany.mock.calls[0][0].where.platform,
  ).toEqual({ equals: 'shop', mode: 'insensitive' });
});
test('inactive platform and stale owner prevent seller queries', async () => {
  const { context, platform, prisma } = fixture();
  platform.ownerUserId = 'transferred';
  const core = new PlatformSellerReports(prisma, {} as any, context);
  await expect(core.getActiveSellers(context.tag)).rejects.toThrow(
    'Plataforma ou dono',
  );
  expect(prisma.externalPlatformUser.findMany).not.toHaveBeenCalled();
});
test('multiple products expose shared stored owner wallet without recalculating product balance', async () => {
  const { prisma } = fixture();
  prisma.platform.findFirst = async () => ({ ownerUserId: 'owner' });
  prisma.platform.count = async () => 2;
  prisma.user = {
    findUnique: async () => ({ name: 'Owner', email: 'owner@example.com' }),
  };
  prisma.wallet = {
    findUnique: async () => ({ balance: 100, lockedBalance: 5 }),
  };
  const result = await new PlatformSellerReports(
    prisma,
    {} as any,
  ).getActiveSellers('BOSQUE', '1', '20', 'true', 'carteiras');
  expect(result.data[0]).toMatchObject({
    walletScope: 'shared-owner',
    balance: 95,
    lockedBalance: 5,
  });
});

test('generic seller stats alias equals scoped canonical projection with real subscriber query', async () => {
  const f = fixture();
  f.context.tag = 'AREAFLIX';
  f.platform.tag = 'AREAFLIX';
  const p: any = f.prisma;
  p.subscriptionLink = { findMany: async () => [{ id: 'link' }] };
  p.subscriptionLinkOrder = {
    findMany: async ({ where }: any) =>
      where.status.in
        ? [{ customerEmail: 'active@example.com' }]
        : [
            { customerEmail: 'active@example.com' },
            { customerEmail: 'expired@example.com' },
          ],
  };
  const old = await new PlatformDashboardController(
    {} as any,
    p,
    {} as any,
  ).getSellerStats('AREAFLIX');
  const current = await new PlatformReportProjectionsController(
    p,
    {} as any,
    {} as any,
  ).sellerStats({ platformContext: f.context });
  expect(old).toEqual({ totalContas: 2, sellersAtivos: 1 });
  expect(current).toEqual(old);
});
