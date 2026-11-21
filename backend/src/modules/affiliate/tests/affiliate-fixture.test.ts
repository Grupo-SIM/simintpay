import { afterAll, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AffiliateService } from '../affiliate.service';
import { captureAffiliate } from '../affiliate-capture';
import {
  CoproductionService,
  captureCoproduction,
  withCoproduction,
} from '../../coproduction/coproduction.service';
import { settleFinalNet } from '../../platform-core/link-settlement';

const url = process.env.COPRODUCTION_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Tests require a local isolated database');
export const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});
export const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 30000);

export async function fixture() {
  const prisma = db!;
  const user = (role: 'ADMIN' | 'USER' = 'USER') =>
    prisma.user.create({
      data: {
        email: `${crypto.randomUUID()}@local.test`,
        name: 'Pessoa',
        password: 'test',
        role,
        clientStatus: 'APPROVED',
      },
    });
  const [owner, aff1, aff2, buyer, outsider, admin] = await Promise.all([
    user(),
    user(),
    user(),
    user(),
    user(),
    user('ADMIN'),
  ]);
  for (const u of [owner, aff1, aff2])
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
  const platform = await prisma.platform.create({
    data: {
      tag: `AFF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'Plataforma',
      ownerUserId: owner.id,
    },
  });
  const offer = await prisma.offer.create({
    data: {
      ownerUserId: owner.id,
      createdByUserId: owner.id,
      code: crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(),
      name: 'Oferta',
      amountCents: 10000,
      acceptedMethods: ['PIX'],
      platformTag: platform.tag,
    } as never,
  });
  const service = new AffiliateService(
    prisma as never,
    new CoproductionService(prisma as never),
  );
  const copro = new CoproductionService(prisma as never);
  const body = (over: Record<string, unknown> = {}) => ({
    version: 0,
    defaultPercentageBps: null,
    commissionOnRenewals: true,
    linkBaseUrl: null,
    affiliates: [],
    ...over,
  });
  const savePlatform = (
    over: Record<string, unknown>,
    version = 0,
    actor = owner.id,
  ) =>
    service.save(actor, 'plataformas', platform.id, body({ version, ...over }));
  const saveOffer = (
    over: Record<string, unknown>,
    version = 0,
    actor = owner.id,
  ) =>
    service.save(
      actor,
      'ofertas',
      offer.id,
      body({ version, commissionOnRenewals: null, ...over }),
    );
  /** Captures like a real checkout and books the sale; `net` in reais. */
  const sale = async (
    code: string | undefined,
    opts: { net?: number; via?: 'offer' | 'api'; buyerEmail?: string } = {},
  ) => {
    const via = opts.via ?? 'offer';
    const key =
      via === 'offer' ? ('ofertas' as const) : ('plataformas' as const);
    const productId = via === 'offer' ? offer.id : platform.id;
    const base = await captureCoproduction(
      prisma,
      key,
      productId,
      owner.id,
      platform.tag,
    );
    const snapshot = await captureAffiliate(prisma, base, {
      product: key,
      productId,
      ownerUserId: owner.id,
      platformTag: platform.tag,
      tracking: code ? { aff: code } : {},
      buyerEmail: opts.buyerEmail ?? buyer.email,
    });
    if (snapshot && snapshot.baseCents === undefined)
      snapshot.baseCents = Math.round((opts.net ?? 100) * 100);
    const row = await prisma.transaction.create({
      data: {
        userId: owner.id,
        amount: (opts.net ?? 100) + 5,
        netAmount: opts.net ?? 100,
        status: 'PENDING',
        settlementBasis: 'FINAL_NET',
        platformTag: platform.tag,
        financialSnapshot: withCoproduction(undefined, snapshot, undefined),
      } as never,
    });
    return { row, snapshot };
  };
  const settle = async (
    id: string,
    status: 'COMPLETED' | 'IN_MEDIATION' | 'CHARGEBACK' | 'REFUNDED',
  ) =>
    prisma.$transaction(async (tx) =>
      settleFinalNet(
        tx,
        await tx.transaction.findUniqueOrThrow({ where: { id } }),
        status,
        'LOCAL_TEST',
      ),
    );
  const wallet = async (id: string) => {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: id } });
    return {
      balance: w.balance.toFixed(2),
      locked: w.lockedBalance.toFixed(2),
    };
  };
  const codeOf = async (userId: string) =>
    (
      await prisma.$queryRaw<
        { code: string }[]
      >`SELECT code FROM "AffiliateCode" WHERE "platformId" = ${platform.id} AND "userId" = ${userId}`
    )[0]?.code as string;
  return {
    prisma,
    owner,
    aff1,
    aff2,
    buyer,
    outsider,
    admin,
    platform,
    offer,
    service,
    copro,
    savePlatform,
    saveOffer,
    sale,
    settle,
    wallet,
    codeOf,
    body,
  };
}
