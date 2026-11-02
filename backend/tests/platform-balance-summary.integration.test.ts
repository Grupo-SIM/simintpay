import { afterAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { readPlatformBalanceSummary } from '../src/modules/platform-core/platform-balance-summary';

const url = process.env.ADMIN_SUMMARY_TEST_DATABASE_URL;
if (
  url &&
  (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.startsWith('/admin_summary'))
) {
  throw new Error(
    'Requires dedicated local disposable admin_summary database without production wallet guards',
  );
}
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});
const run = url ? test : test.skip;
run(
  'summary deduplicates beneficiaries, preserves signed sums, and rejects unknown net-zero history and missing identities',
  async () => {
    const owner = await db!.user.create({
      data: {
        name: 'Summary owner',
        email: `summary-${crypto.randomUUID()}@example.invalid`,
        password: 'fixture',
      },
    });
    const seller = await db!.user.create({
      data: {
        name: 'Summary seller',
        email: `summary-${crypto.randomUUID()}@example.invalid`,
        password: 'fixture',
      },
    });
    await db!.platform.create({
      data: { tag: 'EBOOK', name: 'Summary fixture', ownerUserId: owner.id },
    });
    await db!.wallet.create({
      data: { userId: owner.id, balance: -10, lockedBalance: 0 },
    });
    await db!.wallet.create({
      data: { userId: seller.id, balance: 7, lockedBalance: 2 },
    });
    await db!.externalPlatformUser.createMany({
      data: [
        { name: 'Owner membership', platform: 'ebooksim', userId: owner.id },
        { name: 'Seller alias', platform: 'ebooksim', userId: seller.id },
        { name: 'Seller canonical', platform: 'ebook', userId: seller.id },
      ],
    });
    await db!.balanceLog.createMany({
      data: [
        {
          userId: owner.id,
          source: 'SUMMARY_FIXTURE',
          action: 'INCREMENT',
          description: 'Disposable summary fixture',
          platformTag: 'EBOOK',
          nature: 'OWNER_NET',
          balanceDelta: -10,
          lockedDelta: 0,
        },
        {
          userId: seller.id,
          source: 'SUMMARY_FIXTURE',
          action: 'INCREMENT',
          description: 'Disposable summary fixture',
          platformTag: 'EBOOKSIM',
          nature: 'OWNER_NET',
          balanceDelta: 7,
          lockedDelta: 2,
        },
      ],
    });
    const summary = async () =>
      (await readPlatformBalanceSummary(db!)).find(
        (row) => row.platform === 'ebook',
      );
    expect(await summary()).toMatchObject({
      totalDisponivel: null,
      totalSaldoAtribuido: -3,
      availabilityStatus: 'not-independent',
      totalBloqueado: 2,
      contas: 2,
      attributionStatus: 'complete',
    });
    await db!.balanceLog.createMany({
      data: [1, -1].map((balanceDelta) => ({
        userId: seller.id,
        source: 'SUMMARY_FIXTURE',
        action: 'INCREMENT',
        description: 'Disposable summary fixture',
        platformTag: null,
        nature: null,
        balanceDelta,
        lockedDelta: 0,
      })),
    });
    expect(await summary()).toMatchObject({
      totalDisponivel: null,
      totalBloqueado: null,
      attributionStatus: 'unknown',
    });
    await db!.balanceLog.deleteMany({
      where: { userId: seller.id, platformTag: null },
    });
    await db!.wallet.update({
      where: { userId: seller.id },
      data: { balance: 8 },
    });
    expect(await summary()).toMatchObject({
      totalSaldoAtribuido: null,
      attributionStatus: 'unknown',
    });
    await db!.wallet.update({
      where: { userId: seller.id },
      data: { balance: 7 },
    });
    await db!.platform.create({
      data: { tag: 'EBOOKSIM', name: 'Alias fixture', ownerUserId: owner.id },
    });
    expect(await summary()).toMatchObject({
      totalSaldoAtribuido: -3,
      contas: 2,
    });
    await db!.platform.create({
      data: {
        tag: 'EMPTY-SUMMARY',
        name: 'No beneficiary fixture',
        ownerUserId: owner.id,
      },
    });
    expect(
      (await readPlatformBalanceSummary(db!)).find(
        (row) => row.platform === 'empty-summary',
      ),
    ).toMatchObject({
      totalSaldoAtribuido: null,
      contas: 0,
      attributionStatus: 'unknown',
    });
    await db!.platform.update({
      where: { tag: 'EBOOKSIM' },
      data: { ownerUserId: seller.id },
    });
    expect(await summary()).toMatchObject({
      totalSaldoAtribuido: null,
      attributionStatus: 'unknown',
    });
    await db!.platform.update({
      where: { tag: 'EBOOKSIM' },
      data: { ownerUserId: owner.id },
    });
    await db!.externalPlatformUser.create({
      data: { name: 'Unresolved', platform: 'ebook' },
    });
    expect(await summary()).toMatchObject({
      totalDisponivel: null,
      attributionStatus: 'unknown',
    });
  },
  60_000,
);
