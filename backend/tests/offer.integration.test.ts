import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PrismaUserRepository } from '../src/infrastructure/database/repositories/prisma-user.repository';
import { OfferService } from '../src/modules/offer/offer.service';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;
let service: OfferService;
let seller: { id: string; role: string };
let other: { id: string; role: string };
let admin: { id: string; role: string };

async function user(
  role: 'USER' | 'ADMIN',
  clientStatus: 'APPROVED' | null = 'APPROVED',
) {
  const created = await db!.user.create({
    data: {
      name: role,
      email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.dev`,
      password: 'x',
      role,
      clientStatus: role === 'ADMIN' ? null : clientStatus,
    },
  });
  return { id: created.id, role: created.role };
}

beforeAll(async () => {
  if (!db) return;
  service = new OfferService(
    db as never,
    new PrismaUserRepository(db as never),
  );
  seller = await user('USER');
  other = await user('USER');
  admin = await user('ADMIN');
});
afterAll(async () => {
  await db?.$disconnect();
});

run(
  'creates with explicit recurrence and exposes only safe public fields',
  async () => {
    const offer = await service.create(seller, {
      name: 'Plano PIX',
      amountCents: 4990,
      acceptedMethods: ['PIX'],
      maxInstallments: 1,
      renewalMode: 'MANUAL_PAY',
      accessDays: 30,
    });
    expect(offer.ownerUserId).toBe(seller.id);
    expect(offer.createdByUserId).toBe(seller.id);
    expect(offer.renewalMode).toBe('MANUAL_PAY');
    expect(offer.accessDays).toBe(30);
    expect(offer.code).toMatch(/^[A-Z0-9]{10}$/);

    const pub = await service.getPublicByCode(offer.code);
    expect(pub.name).toBe('Plano PIX');
    expect(Object.keys(pub)).not.toContain('ownerUserId');
    expect(Object.keys(pub)).not.toContain('createdByUserId');
    expect(Object.keys(pub)).not.toContain('id');
  },
);

run('rejects amounts below the minimum and unsupported combos', async () => {
  await expect(
    service.create(seller, {
      name: 'x',
      amountCents: 1000,
    }),
  ).rejects.toThrow('14,99');
  await expect(
    service.create(seller, {
      name: 'x',
      amountCents: 2000,
      acceptedMethods: ['PIX'],
      maxInstallments: 3,
    }),
  ).rejects.toThrow('cartão de crédito');
});

run('boleto offers are flagged as requiring the buyer address', async () => {
  const offer = await service.create(seller, {
    name: 'Boleto',
    amountCents: 3000,
    acceptedMethods: ['BOLETO'],
    maxInstallments: 1,
  });
  expect((await service.getPublicByCode(offer.code)).requiresBuyerAddress).toBe(
    true,
  );
});

run('an admin cannot be the owner and never falls back to it', async () => {
  await expect(
    service.create(admin, {
      name: 'x',
      amountCents: 2000,
    }),
  ).rejects.toThrow();
  const onBehalf = await service.create(admin, {
    name: 'Para cliente',
    amountCents: 2000,
    ownerUserId: seller.id,
  });
  expect(onBehalf.ownerUserId).toBe(seller.id);
  expect(onBehalf.createdByUserId).toBe(admin.id);
});

run('clients only see and change their own offers', async () => {
  const offer = await service.create(seller, {
    name: 'Meu',
    amountCents: 2000,
  });
  expect((await service.list(other)).map((o) => o.id)).not.toContain(offer.id);
  expect((await service.list(seller)).map((o) => o.id)).toContain(offer.id);
  await expect(
    service.update(other, offer.id, { name: 'hack' }),
  ).rejects.toThrow('não encontrada');
  await expect(
    service.update(seller, offer.id, { amountCents: 100 }),
  ).rejects.toThrow('14,99');
  const updated = await service.update(seller, offer.id, { name: 'Novo' });
  expect(updated.name).toBe('Novo');
  expect(updated.ownerUserId).toBe(seller.id);
  expect(updated.code).toBe(offer.code);
});

run('deactivated, expired and exhausted offers are not public', async () => {
  const offer = await service.create(seller, {
    name: 'Some',
    amountCents: 2000,
    maxUses: 1,
  });
  await db!.offer.update({ where: { id: offer.id }, data: { usedCount: 1 } });
  await expect(service.getPublicByCode(offer.code)).rejects.toThrow(
    'não encontrada',
  );
  const active = await service.create(seller, {
    name: 'Ativa',
    amountCents: 2000,
  });
  await service.deactivate(seller, active.id);
  await expect(service.getPublicByCode(active.code)).rejects.toThrow(
    'não encontrada',
  );
});
