import { afterAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { readSellerWalletAttribution } from '../src/modules/platform-core/seller-wallet-attribution';
import { PlatformReportProjectionsController } from '../src/modules/platform-core/platform-report-projections.controller';

const url = process.env.SELLER_ATTRIBUTION_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Local disposable database required');
if (url && !new URL(url).pathname.startsWith('/seller_readers'))
  throw new Error(
    'Requires a dedicated disposable seller_readers database, initialized from the current schema without production wallet guards; never reuse another suite database',
  );
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});
const run = url ? test : test.skip;
run(
  'PostgreSQL seller attribution preserves signed aliases, blocks unknown net-zero and cache mismatch, propagates canonical null',
  async () => {
    const user = await db!.user.create({
      data: {
        name: 'Seller fixture',
        email: `${crypto.randomUUID()}@example.test`,
        password: 'unused',
      },
    });
    await db!.wallet.create({
      data: { userId: user.id, balance: 8, lockedBalance: 0 },
    });
    const entry = (platformTag: string | null, balanceDelta: number) =>
      db!
        .$executeRaw`INSERT INTO "BalanceLog" (id, "userId", source, action, description, "platformTag", nature, "balanceDelta", "lockedDelta", "createdAt") VALUES (${crypto.randomUUID()}, ${user.id}, 'SALE', 'INCREMENT', 'Disposable report fixture', ${platformTag}, 'sale', ${balanceDelta}, 0, NOW())`;
    await entry('EBOOKSIM', -2);
    await entry('EBOOK', 3);
    await entry('ATLAS', 7);
    expect(
      (await readSellerWalletAttribution(db!, [user.id, user.id], 'EBOOK')).get(
        user.id,
      )?.balance,
    ).toBe(1);
    await entry(null, 1);
    await entry(null, -1);
    expect(
      (await readSellerWalletAttribution(db!, [user.id], 'EBOOK')).get(user.id)
        ?.balance,
    ).toBeNull();
    await db!
      .$executeRaw`DELETE FROM "BalanceLog" WHERE "userId" = ${user.id} AND "platformTag" IS NULL`;
    await db!.wallet.update({
      where: { userId: user.id },
      data: { balance: 9 },
    });
    expect(
      (await readSellerWalletAttribution(db!, [user.id], 'EBOOK')).get(user.id)
        ?.balance,
    ).toBeNull();
    const platform = {
      id: crypto.randomUUID(),
      tag: 'EBOOK',
      ownerUserId: user.id,
      isActive: true,
      owner: { isActive: true, isPurged: false },
    };
    const prisma = Object.assign(Object.create(db!), {
      platform: { findUnique: async () => platform },
      community: { findUnique: async () => null },
      externalPlatformUser: {
        findMany: async () =>
          [1, 2].map((id) => ({
            id: String(id),
            userId: user.id,
            user,
            createdAt: new Date(),
          })),
      },
      $queryRaw: db!.$queryRaw.bind(db!),
    });
    const controller = new PlatformReportProjectionsController(
      prisma,
      {} as any,
      {} as any,
    );
    const result = await controller.sellers({
      platformContext: platform as any,
    });
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      balanceCents: null,
      lockedBalanceCents: null,
      balanceStatus: 'unavailable',
    });
  },
);
