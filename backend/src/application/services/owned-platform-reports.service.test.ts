import { expect, mock, test } from 'bun:test';
import {
  OwnedPlatformReportsService,
  reportPagination,
  reportPeriod,
} from './owned-platform-reports.service';
import { Prisma } from '@prisma/client';
import { ReportSessionGuard } from '../../modules/platform-core/report-session.guard';
const user = { sub: 'owner', email: 'owner@test.local', role: 'USER' };
function fixture() {
  const raw = mock(async (query: any) =>
    query.text.includes('FROM "CoproductionAllocation"')
      ? []
      : query.text.includes('FROM (SELECT "productId", participants')
        ? []
        : query.text.includes('SELECT p.id')
          ? [
              {
                id: 'p',
                tag: 'OWN',
                name: 'Minha Loja',
                ownerUserId: 'owner',
                isActive: false,
              },
            ]
          : [
              {
                count: 0n,
                gross: 0,
                fees: 0,
                net: 0,
                refunds: 0,
                refundCount: 0n,
                missing: 0n,
                total: 1n,
              },
            ],
  );
  const db: any = {
    user: {
      findUnique: mock(async () => ({
        id: 'owner',
        role: 'USER',
        isActive: true,
        isPurged: false,
      })),
    },
    platform: {
      findMany: mock(async () => [
        {
          id: 'p',
          tag: 'OWN',
          name: 'Minha Loja',
          ownerUserId: 'owner',
          isActive: false,
        },
      ]),
      count: mock(async () => 1),
    },
    withdrawRequest: {
      findMany: mock(async () => []),
      count: mock(async () => 0),
    },
    $queryRaw: raw,
  };
  db.$transaction = mock(async (f: any) => f(db));
  return { db, service: new OwnedPlatformReportsService(db) };
}
test('catalog restricts owner, includes inactive, searches name/tag and pages in database', async () => {
  const { db, service } = fixture();
  const result = await service.catalog(user, {
    page: '2',
    pageSize: '20',
    search: 'loja',
  });
  const query = db.$queryRaw.mock.calls[0][0];
  expect(query.text).toContain('p."ownerUserId" = $1');
  expect(query.text).toContain('ORDER BY translate(lower(p.name)');
  expect(query.text).toContain('p.tag ASC LIMIT');
  expect(query.values).toEqual(['owner', 'loja', 20, 20]);
  expect(result.data[0].isActive).toBe(false);
  expect(result).toMatchObject({ page: 2, pageSize: 20, total: 1 });
});
test('database role overrides stale admin claim; admin catalog includes all owners', async () => {
  const { db, service } = fixture();
  await service.catalog({ ...user, role: 'ADMIN' }, {});
  expect(db.$queryRaw.mock.calls[0][0].values).toContain('owner');
  db.user.findUnique = async () => ({
    id: 'owner',
    role: 'ADMIN',
    isActive: true,
  });
  await service.catalog(user, {});
  expect(db.$queryRaw.mock.calls[2][0].text).toContain('WHERE true');
});
test('rejects third-party filters before reading data, including after transfer', async () => {
  const { db, service } = fixture();
  db.platform.findMany = async () => [];
  for (const action of [
    () => service.summary(user, { platform: 'OTHER' }),
    () => service.series(user, { platform: 'OTHER' }, 'status'),
    () => service.transactionDetails(user, { platform: 'OTHER' }),
  ])
    await expect(action()).rejects.toThrow('Plataforma indisponível');
  expect(db.$queryRaw.mock.calls).toHaveLength(2);
  expect(
    db.$queryRaw.mock.calls.every(
      ([query]: any[]) =>
        query.text.includes('CoproductionAgreement') ||
        query.text.includes('CoproductionAllocation'),
    ),
  ).toBe(true);
  expect(db.withdrawRequest.findMany).not.toHaveBeenCalled();
});
test('empty ownership returns empty totals and cannot scan global transactions', async () => {
  const { db, service } = fixture();
  db.platform.findMany = async () => [];
  const result = await service.summary(user, {});
  expect(result.platformsCount).toBe(0);
  expect(db.$queryRaw.mock.calls[0][0].text).toContain('a."userId" =');
  expect(db.$queryRaw.mock.calls[0][0].values).toContain('owner');
  expect(db.$queryRaw.mock.calls[1][0].text).toContain('WHERE false');
  expect(result.coproducao?.creditedCents).toBe(0);
  expect(JSON.stringify(result)).not.toMatch(
    /acquirerFee|platformFee|lucro|acquirer|Wallet/,
  );
});
test('scope exact marker and original owner; stable database pagination', async () => {
  const { db, service } = fixture();
  await service.transactionDetails(user, {
    platform: 'OWN',
    page: '3',
    pageSize: '10',
    startDate: '2026-10-01',
    endDate: '2026-10-19',
    paymentMethod: 'PIX',
  });
  const sql = db.$queryRaw.mock.calls[0][0];
  expect(sql.text).toContain('p."ownerUserId" = t."userId"');
  expect(sql.text).toContain('reportAttribution');
  expect(sql.text).toContain('SELECT DISTINCT');
  expect(sql.text).toContain('ARRAY[p.tag]');
  expect(sql.text).toContain('ORDER BY "createdAt" DESC, id ASC LIMIT');
  expect(sql.values).toContain('p');
  expect(sql.values).toContain('PIX');
  expect(sql.values.slice(-2)).toEqual([10, 20]);
  expect(
    sql.values.some(
      (v: unknown) =>
        v instanceof Date && v.toISOString() === '2026-10-20T03:00:00.000Z',
    ),
  ).toBe(true);
});
test('rejects admin balances for owner and owner reports for integration credentials', async () => {
  const { db, service } = fixture();
  await expect(service.balances(user, {})).rejects.toThrow(
    'Exige administrador',
  );
  await expect(
    service.summary({ ...user, authMode: 'integration' }, {}),
  ).rejects.toThrow('Exige sessão');
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
test('validates pagination, dates, methods and structured query values', () => {
  for (const filters of [
    { page: '0' },
    { page: '1.5' },
    { page: '9007199254740992' },
    { pageSize: '101' },
    { search: [] },
  ])
    expect(() => reportPagination(filters as any)).toThrow();
  for (const filters of [
    { startDate: '2026-02-30' },
    { startDate: '2026-10-20', endDate: '2026-10-01' },
    { paymentMethod: 'CASH' },
    { platform: {} },
  ])
    expect(() => reportPeriod(filters as any)).toThrow();
});
test('canonical internal economics reject session owners', () => {
  const guard = new ReportSessionGuard();
  const context = (actor: unknown): any => ({
    switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
  });
  expect(() => guard.canActivate(context(user))).toThrow(
    'Consulte os relatórios',
  );
  expect(guard.canActivate(context({ ...user, role: 'ADMIN' }))).toBe(true);
  expect(guard.canActivate(context(undefined))).toBe(true);
});

test('admin balances preserve inactive, negative product and separate shared owner wallet', async () => {
  const { db, service } = fixture();
  const platforms = ['ALPHA', 'BETA'].map((tag, i) => ({
    id: `p-${i}`,
    tag,
    name: tag,
    isActive: false,
    ownerUserId: 'owner',
    acquirer: 'DOM',
    owner: { name: 'Dono', email: 'owner@test.local', isActive: true },
  }));
  db.user.findUnique = async () => ({
    id: 'admin',
    role: 'ADMIN',
    isActive: true,
  });
  db.$queryRaw = mock(async (q: any) =>
    q.text.includes('SELECT p.id')
      ? platforms.map((p) => ({
          ...p,
          ownerName: p.owner.name,
          ownerEmail: p.owner.email,
        }))
      : [{ total: 2n }],
  );
  db.platform.findMany = mock(async () => platforms);
  db.platform.findUnique = async (q: any) =>
    platforms.find((p) => p.id === q.where.id);
  db.platform.count = async () => 2;
  db.transaction = {
    findMany: async () => [
      {
        description: '[TENANT:ALPHA]',
        platformTag: 'ALPHA',
        netAmount: new Prisma.Decimal(100),
      },
      {
        description: '[TENANT:BETA]',
        platformTag: 'BETA',
        netAmount: new Prisma.Decimal(20),
      },
    ],
  };
  db.wallet = {
    findUnique: async () => ({ balance: new Prisma.Decimal(1000) }),
  };
  db.withdrawRequest.findMany = async (q: any) =>
    q.where.platform.in.includes('beta')
      ? [{ status: 'COMPLETED', grossAmount: new Prisma.Decimal(30) }]
      : [{ status: 'PENDING', grossAmount: new Prisma.Decimal(10) }];
  const result = await service.balances(user, {});
  expect(result.data[0]).toMatchObject({
    availableBalanceCents: 9000,
    balanceCents: 10000,
    pendingWithdrawalsGrossCents: 1000,
    walletScope: 'shared-owner',
    ownerWalletBalanceCents: 100000,
    isActive: false,
  });
  expect(result.data[1]).toMatchObject({
    availableBalanceCents: 0,
    balanceCents: -1000,
    walletScope: 'shared-owner',
    ownerWalletBalanceCents: 100000,
  });
  expect(db.$queryRaw.mock.calls[0][0].text).toContain(
    'ORDER BY translate(lower(p.name)',
  );
  expect(db.$queryRaw.mock.calls[0][0].values.slice(-2)).toEqual([12, 0]);
  expect('totalOwnerWalletBalanceCents' in result).toBe(false);
});

test('withdrawal costs sum persisted fees only for approved and completed withdrawals in report scope', async () => {
  const { db, service } = fixture();
  db.withdrawRequest.findMany = mock(async () => [
    {
      status: 'APPROVED',
      grossAmount: new Prisma.Decimal(100),
      fee: new Prisma.Decimal('2.35'),
    },
    {
      status: 'COMPLETED',
      grossAmount: new Prisma.Decimal(80),
      fee: new Prisma.Decimal('3.10'),
    },
    {
      status: 'PENDING',
      grossAmount: new Prisma.Decimal(50),
      fee: new Prisma.Decimal(9),
    },
    {
      status: 'REJECTED',
      grossAmount: new Prisma.Decimal(60),
      fee: new Prisma.Decimal(8),
    },
  ]);
  const result = await service.summary(user, {
    platform: 'OWN',
    startDate: '2026-10-01',
    endDate: '2026-10-19',
  });
  expect(result.summary).toMatchObject({
    withdrawalFeesCents: 545,
    withdrawalsCents: 18000,
    pendingWithdrawalsCents: 5000,
  });
  const query = db.withdrawRequest.findMany.mock.calls[0][0];
  expect(query.where.OR[0].userId).toBe('owner');
  expect(query.where.createdAt.gte.toISOString()).toBe(
    '2026-10-01T03:00:00.000Z',
  );
  expect(query.where.createdAt.lt.toISOString()).toBe(
    '2026-10-20T03:00:00.000Z',
  );
});
