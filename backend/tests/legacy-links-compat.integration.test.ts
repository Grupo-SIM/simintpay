import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { CreatePaymentLinkUseCase } from '../src/application/use-cases/payment-link/create-payment-link.use-case';
import { DeletePaymentLinkUseCase } from '../src/application/use-cases/payment-link/delete-payment-link.use-case';
import { GetPaymentLinkUseCase } from '../src/application/use-cases/payment-link/get-payment-link.use-case';
import { ListPaymentLinksUseCase } from '../src/application/use-cases/payment-link/list-payment-links.use-case';
import { UpdatePaymentLinkUseCase } from '../src/application/use-cases/payment-link/update-payment-link.use-case';
import { useEmptyCaches } from '../src/application/use-cases/payment-link/charge-characterization.fixture';
import { CreateSubscriptionLinkUseCase } from '../src/application/use-cases/subscription-link/create-subscription-link.use-case';
import { DeleteSubscriptionLinkUseCase } from '../src/application/use-cases/subscription-link/delete-subscription-link.use-case';
import { GetSubscriptionLinkUseCase } from '../src/application/use-cases/subscription-link/get-subscription-link.use-case';
import { ListSubscriptionLinksUseCase } from '../src/application/use-cases/subscription-link/list-subscription-links.use-case';
import { UpdateSubscriptionLinkUseCase } from '../src/application/use-cases/subscription-link/update-subscription-link.use-case';
import { PrismaPaymentLinkRepository } from '../src/infrastructure/database/repositories/prisma-payment-link.repository';
import { PrismaSubscriptionLinkRepository } from '../src/infrastructure/database/repositories/prisma-subscription-link.repository';
import { PrismaUserRepository } from '../src/infrastructure/database/repositories/prisma-user.repository';
import { LegacyLinksCompatService } from '../src/modules/offer/legacy-links.compat.service';
import {
  OfferFulfillmentService,
  PrismaFulfillmentMarkers,
} from '../src/modules/offer/offer-fulfillment.service';
import { PrismaOfferSalesEventOutbox } from '../src/modules/offer/offer-sales-event-outbox';
import { OfferService } from '../src/modules/offer/offer.service';

setDefaultTimeout(60_000);
const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;

/** Gateway double: legacy use cases only need ids back. */
const gateway: any = {
  createPaymentLink: async () => ({ id: `dom-${crypto.randomUUID()}` }),
  createPlan: async () => ({ id: `plan-${crypto.randomUUID()}` }),
  updatePaymentLink: async () => ({}),
  deletePaymentLink: async () => ({}),
};

let seller: { id: string; role: string };
let other: { id: string; role: string };
let legacy: Record<string, any>;
let compat: LegacyLinksCompatService;

/**
 * Key and value types of a response; `null` matches anything because legacy rows carry a
 * platform tag string where an offer has none, and the other way around.
 */
function shape(value: unknown): unknown {
  if (value === null || value === undefined) return '*';
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : [];
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as object)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shape(v)]),
    );
  return typeof value;
}
function expectSameShape(actual: unknown, expected: unknown) {
  const walk = (a: any, e: any, path: string) => {
    if (e === '*' || a === '*') return;
    if (Array.isArray(e)) {
      expect(Array.isArray(a)).toBe(true);
      if (e.length && a.length) walk(a[0], e[0], `${path}[]`);
      return;
    }
    if (typeof e === 'object') {
      expect(Object.keys(a).sort(), path).toEqual(Object.keys(e).sort());
      for (const k of Object.keys(e)) walk(a[k], e[k], `${path}.${k}`);
      return;
    }
    expect(a, path).toBe(e);
  };
  walk(shape(actual), shape(expected), '$');
}

async function user() {
  const created = await db!.user.create({
    data: {
      name: 'Seller',
      email: `seller-${crypto.randomUUID()}@test.dev`,
      password: 'x',
      role: 'USER',
      clientStatus: 'APPROVED',
    },
  });
  return { id: created.id, role: created.role };
}

beforeAll(async () => {
  if (!db) return;
  process.env.DOM_TOKEN = 'test-token';
  await useEmptyCaches();
  seller = await user();
  other = await user();
  const users = new PrismaUserRepository(db as never);
  const pRepo = new PrismaPaymentLinkRepository(db as never);
  const sRepo = new PrismaSubscriptionLinkRepository(db as never);
  legacy = {
    createP: new CreatePaymentLinkUseCase(pRepo, gateway, users),
    listP: new ListPaymentLinksUseCase(pRepo, db as never),
    getP: new GetPaymentLinkUseCase(pRepo),
    updateP: new UpdatePaymentLinkUseCase(pRepo, gateway),
    delP: new DeletePaymentLinkUseCase(pRepo, gateway),
    createS: new CreateSubscriptionLinkUseCase(
      sRepo,
      users,
      gateway,
      db as never,
      {} as never,
    ),
    listS: new ListSubscriptionLinksUseCase(sRepo, db as never),
    getS: new GetSubscriptionLinkUseCase(sRepo, db as never),
    updateS: new UpdateSubscriptionLinkUseCase(sRepo, gateway, {} as never),
    delS: new DeleteSubscriptionLinkUseCase(sRepo, gateway),
  };
  compat = new LegacyLinksCompatService(
    new OfferService(db as never, users),
    db as never,
    users,
  );
});
afterAll(async () => {
  await db?.$disconnect();
});

run('payment link: compat responses have the legacy shapes', async () => {
  const dto: any = {
    titulo: 'Curso',
    descricao: 'd',
    valor: 99.9,
    parcelasMax: 3,
    redirectUrl: 'https://example.com/ok',
    emailBody: 'obrigado',
    maxUses: 5,
    dataExpiracao: '2031-01-01T00:00:00.000Z',
  };
  const a = await legacy.createP.execute({ userId: seller.id, dto });
  const b = await compat.createPaymentLink(seller, dto);
  expectSameShape(b, a);
  expect(b.data.valor).toBe(99.9);

  const ga = {
    data: {
      ...((await legacy.getP.execute({ userId: seller.id, id: a.data.id }))
        .data as object),
      files: [],
      ofertas: [],
    },
  };
  const gb = await compat.getPaymentLink(seller, b.data.id);
  expectSameShape(gb, ga);
  expect(gb.data).toMatchObject({
    redirectUrl: 'https://example.com/ok',
    emailBody: 'obrigado',
    webhookUrl: null,
    aceitaPix: true,
  });

  expectSameShape(
    await compat.listPaymentLinks(seller, { page: 1, pageSize: 20 }),
    await legacy.listP.execute({
      userId: seller.id,
      role: 'USER',
      query: { page: 1, pageSize: 20 },
    }),
  );

  const upd = { titulo: 'Novo', valor: 120, aceitaCartao: false };
  expectSameShape(
    await compat.updatePaymentLink(seller, b.data.id, upd),
    await legacy.updateP.execute({
      userId: seller.id,
      id: a.data.id,
      dto: upd,
    }),
  );
  const after = await db!.offer.findUniqueOrThrow({ where: { id: b.data.id } });
  expect(after.acceptedMethods).toEqual(['DEBIT_CARD', 'PIX']);
  expect(after.maxInstallments).toBe(1);
  expect(after.fulfillment).toMatchObject({ emailBody: 'obrigado' });

  expect(await compat.deletePaymentLink(seller, b.data.id)).toEqual({
    deleted: true,
  });
  expect(
    (await db!.offer.findUniqueOrThrow({ where: { id: b.data.id } })).isActive,
  ).toBe(false);
});

run('subscription link: compat responses have the legacy shapes', async () => {
  const dto: any = {
    nome: 'Plano',
    descricao: 'd',
    valor: 29.9,
    frequencia: 'ANUAL',
    emailBody: 'bem-vindo',
  };
  const a = await legacy.createS.execute({
    userId: seller.id,
    role: 'USER',
    dto,
  });
  const b = await compat.createSubscriptionLink(seller, dto);
  expectSameShape(b, a);
  expect(b.data.frequencia).toBe('ANUAL');

  expectSameShape(
    await compat.getSubscriptionLink(seller, b.data.id),
    await legacy.getS.execute({
      userId: seller.id,
      role: 'USER',
      id: a.data.id,
    }),
  );
  expectSameShape(
    await compat.listSubscriptionLinks(seller, { page: 1, pageSize: 20 }),
    await legacy.listS.execute({
      userId: seller.id,
      role: 'USER',
      page: 1,
      pageSize: 20,
    }),
  );
  const upd = { nome: 'Plano 2', frequencia: 'SEMESTRAL', isActive: true };
  expectSameShape(
    await compat.updateSubscriptionLink(seller, b.data.id, upd),
    await legacy.updateS.execute({
      userId: seller.id,
      role: 'USER',
      id: a.data.id,
      dto: upd,
    }),
  );
  const offer = await db!.offer.findUniqueOrThrow({ where: { id: b.data.id } });
  expect(offer).toMatchObject({
    renewalMode: 'AUTO_CHARGE',
    intervalType: 'MONTH',
    intervalCount: 6,
    accessDays: 180,
  });
  const detail = await compat.getSubscriptionLink(seller, b.data.id);
  expect(detail.data).toMatchObject({
    frequencia: 'SEMESTRAL',
    frequencyType: 'SEMESTRAL',
  });

  const pub = await compat.getPublicSubscriptionLink(offer.code);
  expect(pub).toMatchObject({
    id: offer.id,
    codigo: offer.code,
    frequencia: 'SEMESTRAL',
  });
  expect(await compat.deleteSubscriptionLink(seller, b.data.id)).toEqual({
    deleted: true,
  });
});

run('ownership and below-minimum rules are the offer ones', async () => {
  const created = await compat.createPaymentLink(seller, {
    titulo: 'Meu',
    valor: 50,
  } as any);
  await expect(compat.getPaymentLink(other, created.data.id)).rejects.toThrow(
    'Link não encontrado',
  );
  await expect(
    compat.updatePaymentLink(other, created.data.id, { titulo: 'x' }),
  ).rejects.toThrow('Link não encontrado');
  await expect(
    compat.deletePaymentLink(other, created.data.id),
  ).rejects.toThrow('Link não encontrado');
  // A payment link is not a subscription link.
  await expect(
    compat.getSubscriptionLink(seller, created.data.id),
  ).rejects.toThrow('Link de assinatura não encontrado');
  await expect(
    compat.createPaymentLink(seller, { titulo: 'Barato', valor: 5 } as any),
  ).rejects.toThrow('14,99');
  // The other seller's list never contains it.
  const list = await compat.listPaymentLinks(other, {});
  expect(list.data.find((l) => l.id === created.data.id)).toBeUndefined();
});

run(
  'subscription_activated: queued once, only for the first paid cycle',
  async () => {
    const owner = await user();
    const tag = `HOOK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const platform = await db!.platform.create({
      data: { tag, name: tag, ownerUserId: owner.id },
    });
    await db!.platformIntegration.createMany({
      data: [
        { platformId: platform.id, key: 'WEBHOOK_SECRET', encryptedValue: 'x' },
        {
          platformId: platform.id,
          key: 'WEBHOOK_URL',
          url: 'https://hook.example.com/in',
        },
      ],
    });
    const offer = await db!.offer.create({
      data: {
        ownerUserId: owner.id,
        createdByUserId: owner.id,
        platformTag: tag,
        code: `S${crypto.randomUUID().slice(0, 9).toUpperCase()}`,
        kind: 'SUBSCRIPTION_LINK',
        name: 'Plano Mensal',
        amountCents: 3990,
        acceptedMethods: ['CREDIT_CARD'],
        renewalMode: 'AUTO_CHARGE',
        intervalType: 'MONTH',
        intervalCount: 1,
      },
    });
    const contract = await db!.billingContract.create({
      data: {
        userId: owner.id,
        resourceType: 'OFFER',
        resourceId: crypto.randomUUID(),
        offerId: offer.id,
        unitAmount: 39.9,
        quantity: 1,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        customerEmail: 'ana@test.dev',
      },
    });
    async function cycle(n: number, paidAt: Date) {
      const tx = await db!.transaction.create({
        data: {
          userId: owner.id,
          amount: 39.9,
          netAmount: 36.5,
          status: 'COMPLETED',
          paymentMethod: 'CREDIT_CARD',
          customerEmail: 'ana@test.dev',
          customerName: 'Ana',
          platformTag: tag,
        },
      });
      const charge = await db!.charge.create({
        data: {
          offerId: offer.id,
          contractId: contract.id,
          ownerUserId: owner.id,
          amountCents: 3990,
          status: 'PAID',
          cycleKey: `c${n}`,
          paidAt,
          customerEmail: 'ana@test.dev',
          customerName: 'Ana',
          transactionId: tx.id,
          snapshot: {},
        },
      });
      return { tx, charge };
    }
    const first = await cycle(1, new Date('2026-01-01T00:00:00Z'));
    const second = await cycle(2, new Date('2026-02-01T00:00:00Z'));

    const outbox = new PrismaOfferSalesEventOutbox(db as never);
    outbox.resolve = async () => ['93.184.216.34'];
    const service = new OfferFulfillmentService(
      db as never,
      new PrismaFulfillmentMarkers(db as never),
      undefined,
      undefined,
      outbox,
    );
    const rows = () =>
      db!.$queryRaw<{ eventId: string; url: string; payload: any }[]>`
      SELECT "eventId", url, payload FROM "PlatformSalesEvent" WHERE "platformId" = ${platform.id}`;

    expect(
      await service.deliver({ transactionId: first.tx.id, kind: 'PAID' }),
    ).toBe('done');
    await service.deliver({ transactionId: first.tx.id, kind: 'PAID' });
    await service.deliver({ transactionId: second.tx.id, kind: 'PAID' });

    const events = await rows();
    expect(events).toHaveLength(1);
    expect(events[0].url).toBe('https://hook.example.com/in');
    expect(events[0].payload).toMatchObject({
      event: 'subscription_activated',
      orderId: first.tx.id,
      linkId: offer.id,
      planName: 'Plano Mensal',
      frequencyType: 'MONTHLY',
      amountCharged: 39.9,
      netAmount: 36.5,
      customerEmail: 'ana@test.dev',
    });
    const marker = await db!.charge.findUniqueOrThrow({
      where: { id: first.charge.id },
    });
    expect(
      (marker.snapshot as any).fulfillment.subscriptionActivated,
    ).toBeTruthy();
    const later = await db!.charge.findUniqueOrThrow({
      where: { id: second.charge.id },
    });
    expect(
      (later.snapshot as any)?.fulfillment?.subscriptionActivated,
    ).toBeUndefined();
  },
);
