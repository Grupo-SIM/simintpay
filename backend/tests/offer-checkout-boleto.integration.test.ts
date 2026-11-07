import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { useEmptyCaches } from '../src/application/use-cases/payment-link/charge-characterization.fixture';
import { Acquirer } from '../src/core/services/acquirer.enum';
import { acquirerCapabilities } from '../src/core/services/acquirer-capabilities';
import { PrismaUserRepository } from '../src/infrastructure/database/repositories/prisma-user.repository';
import { markChargeSettled } from '../src/modules/billing-core/charge-settlement';
import { ExternalRefService } from '../src/modules/billing-core/external-ref.service';
import { OfferCheckoutService } from '../src/modules/offer/offer-checkout.service';
import { settleFinalNet } from '../src/modules/platform-core/link-settlement';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;

let service: OfferCheckoutService;
let ownerId: string;
const calls = { link: [] as any[], boleto: [] as any[] };

const buyer = {
  customerName: 'Ana',
  customerEmail: 'ana@test.dev',
  customerDocument: '123.456.789-09',
  customerPhone: '(11) 99999-0000',
  cep: '50000-000',
  rua: 'Rua A',
  numero: '10',
  bairro: 'Centro',
  cidade: 'Recife',
  uf: 'PE',
};

async function offer(over: Record<string, unknown> = {}) {
  return db!.offer.create({
    data: {
      ownerUserId: ownerId,
      createdByUserId: ownerId,
      code: `B${crypto.randomUUID().slice(0, 9).toUpperCase()}`,
      name: 'Boleto',
      amountCents: 10000,
      acceptedMethods: ['BOLETO'],
      maxInstallments: 1,
      metadata: { boletoDueDays: 7, requiresBuyerAddress: true },
      ...over,
    },
  });
}

beforeAll(async () => {
  if (!db) return;
  process.env.DOM_TOKEN = 'test-token';
  await useEmptyCaches();
  const owner = await db.user.create({
    data: {
      name: 'Seller',
      email: `seller-${crypto.randomUUID()}@test.dev`,
      password: 'x',
      role: 'USER',
      clientStatus: 'APPROVED',
    },
  });
  ownerId = owner.id;
  await db.acquirerCatalogue.upsert({
    where: { code: 'DOM' },
    update: {},
    create: { code: 'DOM', name: 'DOM' },
  });
  const gateway: any = {
    createPaymentLink: async (_t: string, input: any) => {
      calls.link.push(input);
      return { id: `dom-link-${crypto.randomUUID()}` };
    },
    chargeBoletoForLink: async (_t: string, input: any) => {
      calls.boleto.push(input);
      return {
        id: `dom-bol-${crypto.randomUUID()}`,
        status: 'waiting',
        boletoUrl: 'https://dom.test/boleto.pdf',
        barcode: null,
        digitableLine: '34191.79001 01043.510047 91020.150008 1 99990000010000',
        dueDate: '2026-12-10',
        amount: input.amount,
      };
    },
  };
  service = new OfferCheckoutService(
    db as never,
    new PrismaUserRepository(db as never),
    {
      acquirerForSlug: () => Acquirer.DOM,
      capabilitiesFor: acquirerCapabilities,
      byAcquirer: () => gateway,
    } as never,
    new ExternalRefService(db as never),
  );
});
afterAll(async () => {
  await db?.$disconnect();
});

const settle = (transactionId: string, status: 'COMPLETED' | 'EXPIRED') =>
  db!.$transaction(async (p) => {
    const row = await p.transaction.findUniqueOrThrow({
      where: { id: transactionId },
    });
    const settled = await settleFinalNet(p, row, status, 'DOM_WEBHOOK');
    if (settled) await markChargeSettled(p, row.id, status);
    return settled;
  });

const wallet = async () =>
  Number(
    (await db!.wallet.findUniqueOrThrow({ where: { userId: ownerId } }))
      .balance,
  );

run(
  'boleto persists Charge + FINAL_NET Transaction, boleto link, then settles PAID once',
  async () => {
    const o = await offer();
    const out = await service.charge(o.code, {
      paymentMethod: 'boleto',
      ...buyer,
    });
    expect(out).toMatchObject({
      boletoUrl: 'https://dom.test/boleto.pdf',
      boletoExpiresAt: '2026-12-10',
      pixContent: null,
    });
    expect(out.boletoDigitableLine).toContain('34191');
    const charge = await db!.charge.findUniqueOrThrow({
      where: { id: out.chargeId },
    });
    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: out.transactionId },
    });
    expect(charge).toMatchObject({
      offerId: o.id,
      status: 'PENDING',
      method: 'BOLETO',
      transactionId: tx.id,
    });
    expect(tx).toMatchObject({
      status: 'PENDING',
      settlementBasis: 'FINAL_NET',
      paymentMethod: 'BOLETO',
      userId: ownerId,
    });
    expect(tx.domPaymentId).toStartWith('dom-bol-');
    expect(calls.boleto.at(-1)).toMatchObject({
      expireDays: 7,
      codExternal: tx.id,
      address: { zipCode: '50000000', uf: 'PE', number: '10' },
    });
    expect(calls.link.at(-1)).toMatchObject({
      aceitaBoleto: true,
      aceitaCartao: false,
      boletoExpireDay: 7,
    });
    expect(
      await db!.externalRef.count({
        where: { entityType: 'Offer', entityId: o.id, kind: 'PAYMENT_LINK' },
      }),
    ).toBe(1);

    const before = await wallet().catch(() => 0);
    expect(await settle(tx.id, 'COMPLETED')).toBe(true);
    expect(await settle(tx.id, 'COMPLETED')).toBe(false);
    const paid = await db!.charge.findUniqueOrThrow({
      where: { id: charge.id },
    });
    expect(paid.status).toBe('PAID');
    expect(+((await wallet()) - before).toFixed(2)).toBe(Number(tx.netAmount));
  },
);

run(
  'an expired boleto turns the Charge EXPIRED and credits nothing',
  async () => {
    const o = await offer();
    const out = await service.charge(o.code, {
      paymentMethod: 'boleto',
      ...buyer,
    });
    const before = await wallet();
    expect(await settle(out.transactionId, 'EXPIRED')).toBe(true);
    expect(
      (await db!.charge.findUniqueOrThrow({ where: { id: out.chargeId } }))
        .status,
    ).toBe('EXPIRED');
    expect(
      (
        await db!.transaction.findUniqueOrThrow({
          where: { id: out.transactionId },
        })
      ).status,
    ).toBe('EXPIRED');
    expect(await wallet()).toBe(before);
    // A late payment cannot revive an expired boleto.
    expect(await settle(out.transactionId, 'COMPLETED')).toBe(false);
  },
);

run('a migrated offer reuses its existing gateway link ref', async () => {
  const o = await offer();
  await db!.externalRef.create({
    data: {
      acquirerCode: 'DOM',
      kind: 'PAYMENT_LINK',
      externalId: `legacy-link-${o.id}`,
      entityType: 'Offer',
      entityId: o.id,
    },
  });
  const links = calls.link.length;
  await service.charge(o.code, { paymentMethod: 'boleto', ...buyer });
  expect(calls.link.length).toBe(links);
});

run('maxUses is atomic for boleto and bad requests write nothing', async () => {
  const o = await offer({ maxUses: 2 });
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      service.charge(o.code, { paymentMethod: 'boleto', ...buyer }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
  expect(
    (await db!.offer.findUniqueOrThrow({ where: { id: o.id } })).usedCount,
  ).toBe(2);

  const p = await offer();
  await expect(
    service.charge(p.code, { paymentMethod: 'boleto', ...buyer, cep: '1' }),
  ).rejects.toThrow('endereço completo');
  await expect(
    service.charge(p.code, {
      paymentMethod: 'boleto',
      ...buyer,
      bumpCodes: ['X'],
    }),
  ).rejects.toThrow('order bumps');
  const pixOnly = await offer({ acceptedMethods: ['PIX'] });
  await expect(
    service.charge(pixOnly.code, { paymentMethod: 'boleto', ...buyer }),
  ).rejects.toThrow('não aceita');
  expect(
    await db!.charge.count({
      where: { offerId: { in: [p.id, pixOnly.id] } },
    }),
  ).toBe(0);
});
