import { afterAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AdminController } from '../src/presentation/controllers/admin.controller';

const url = process.env.EXTERNAL_EXPORT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    parsed.pathname !== '/external_export_fixture' ||
    parsed.search
  )
    throw new Error(
      'Dedicated local external_export_fixture database without query overrides required',
    );
}
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});
(url ? test : test.skip)(
  'CSV export uses explicit beneficiary, signed aliases, dedup and honest nulls',
  async () => {
    await db!.$executeRawUnsafe('CREATE TABLE "User" (id text PRIMARY KEY)');
    await db!.$executeRawUnsafe(
      'CREATE TABLE "Wallet" ("userId" text, balance numeric, "lockedBalance" numeric)',
    );
    await db!.$executeRawUnsafe(
      'CREATE TABLE "BalanceLog" (id text, "userId" text, "platformTag" text, nature text, "balanceDelta" numeric, "lockedDelta" numeric)',
    );
    await db!.$executeRawUnsafe(
      `INSERT INTO "User" VALUES ('seller'), ('unknown')`,
    );
    await db!.$executeRawUnsafe(
      `INSERT INTO "Wallet" VALUES ('seller', 100, 3), ('unknown', 0, 0)`,
    );
    await db!.$executeRawUnsafe(
      `INSERT INTO "BalanceLog" VALUES ('1','seller','EBOOKSIM','SALE',120,5), ('2','seller','EBOOK','SALE',-20,-2), ('3','unknown',NULL,NULL,0,0)`,
    );
    const row = (id: string, userId: string | null, platform: string) => ({
      id,
      userId,
      platform,
      name: id,
      cpf: '',
      cnpj: '',
      createdAt: new Date(),
      user: userId ? { name: userId, email: 'same@example.test' } : null,
      wallet: { balance: 99999, lockedBalance: 99999 },
    });
    const items = [
      row('one', 'seller', 'EBOOKSIM'),
      row('duplicate', 'seller', 'EBOOK'),
      row('unknown', 'unknown', 'EBOOK'),
      row('unlinked', null, 'EBOOK'),
      row('atlas', 'seller', 'ATLAS'),
    ];
    let query: any;
    const controller = Object.create(
      AdminController.prototype,
    ) as AdminController;
    Object.assign(controller, {
      prisma: {
        externalPlatformUser: {
          findMany: async (args: any) => {
            query = args;
            return items;
          },
        },
        transaction: {
          findMany: async () => [{ userId: 'seller', platformTag: 'EBOOKSIM' }],
        },
        $queryRaw: db!.$queryRaw.bind(db!),
      },
    });
    const result = await controller.exportExternalUsers('ebooksim');
    expect(query.where).toEqual({ isDeleted: false });
    expect(query.include).not.toHaveProperty('wallet');
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      plataforma: 'EBOOK',
      saldo: 100,
      saldoBloqueado: 3,
      balanceStatus: 'complete',
      walletScope: 'beneficiary-platform',
    });
    expect(result[1]).toMatchObject({
      saldo: null,
      balanceStatus: 'unavailable',
      historicalAttributionComplete: false,
    });
    expect(result[2]).toMatchObject({
      saldo: null,
      vinculado: false,
      status: 'Não determinado',
    });
    const all = await controller.exportExternalUsers();
    expect(all).toHaveLength(4);
    expect(all[0].status).toBe('Ativo');
    expect(all[3]).toMatchObject({
      plataforma: 'ATLAS',
      status: 'Inativo',
      saldo: 0,
    });
  },
  30000,
);
