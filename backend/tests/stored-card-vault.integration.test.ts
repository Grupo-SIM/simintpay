import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { BillingCycleService } from '../src/modules/billing-core/billing-cycle.service';
import { StoredCardCycleExecutor } from '../src/modules/billing-core/stored-card-cycle.executor';
import { StoredCardVaultService } from '../src/modules/billing-core/stored-card-vault.service';

const url = process.env.BILLING_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;
const t0 = new Date('2026-01-01T00:00:00.000Z');
const day = 24 * 60 * 60 * 1000;
let vault: StoredCardVaultService;
let cycles: BillingCycleService;
let ownerId: string;

beforeAll(async () => {
  if (!db) return;
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  vault = new StoredCardVaultService(db as never);
  cycles = new BillingCycleService(db as never);
  await db.acquirerCatalogue.upsert({
    where: { code: 'DOM' },
    update: {},
    create: { code: 'DOM', name: 'DOM' },
  });
  await db.acquirerCatalogue.upsert({
    where: { code: 'FRENDZ' },
    update: {},
    create: { code: 'FRENDZ', name: 'Frendz' },
  });
  const owner = await db.user.create({
    data: {
      name: 'Seller',
      email: `seller-${crypto.randomUUID()}@test.dev`,
      password: 'x',
      domToken: 'seller-dom-token',
    },
  });
  ownerId = owner.id;
});
afterAll(async () => {
  await db?.$disconnect();
});

async function activeContract(email: string) {
  const offer = await db!.offer.create({
    data: {
      ownerUserId: ownerId,
      createdByUserId: ownerId,
      code: `OFF-${crypto.randomUUID()}`,
      kind: 'PLAN',
      name: 'Plano',
      amountCents: 4990,
      acceptedMethods: ['CREDIT_CARD'],
      renewalMode: 'AUTO_CHARGE',
      intervalType: 'MONTH',
      intervalCount: 1,
      retryDays: 3,
      graceDays: 7,
    },
  });
  const { contract, charge } = await cycles.subscribe({
    offerId: offer.id,
    customerName: 'Buyer',
    customerEmail: email,
    now: t0,
  });
  await cycles.settle(charge.id, 'PAID', t0);
  return db!.billingContract.findUniqueOrThrow({ where: { id: contract.id } });
}

run(
  'stores only the encrypted token and resolves it per acquirer',
  async () => {
    const contract = await activeContract('vault@test.dev');
    const card = await vault.save({
      ownerUserId: ownerId,
      contractId: contract.id,
      customerEmail: 'Vault@test.dev',
      acquirerCode: 'DOM',
      token: 'tok_plain_secret',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2099,
    });
    const row = await db!.storedCardToken.findFirstOrThrow({
      where: { storedCardId: card.id },
    });
    expect(row.encryptedToken).not.toContain('tok_plain_secret');
    expect(row.encryptedToken.startsWith('v1:')).toBe(true);
    expect(await vault.resolveForContract(contract.id, 'DOM')).toEqual({
      storedCardId: card.id,
      token: 'tok_plain_secret',
    });
    expect(await vault.resolveForContract(contract.id, 'FRENDZ')).toBeNull();
    await expect(
      (async () =>
        db!.storedCardToken.create({
          data: {
            storedCardId: card.id,
            acquirerCode: 'DOM',
            encryptedToken: 'x',
          },
        }))(),
    ).rejects.toThrow();
  },
);

run(
  'replacing the card revokes the previous one; revoke hides it',
  async () => {
    const contract = await activeContract('swap@test.dev');
    const base = {
      ownerUserId: ownerId,
      contractId: contract.id,
      customerEmail: 'swap@test.dev',
      acquirerCode: 'DOM',
      last4: '1111',
      expMonth: 12,
      expYear: 2099,
    };
    const first = await vault.save({ ...base, token: 'tok_one' });
    const second = await vault.save({ ...base, token: 'tok_two' });
    expect(
      (await db!.storedCard.findUniqueOrThrow({ where: { id: first.id } }))
        .status,
    ).toBe('REVOKED');
    expect((await vault.resolveForContract(contract.id, 'DOM'))?.token).toBe(
      'tok_two',
    );
    await vault.revoke(second.id);
    expect(await vault.resolveForContract(contract.id, 'DOM')).toBeNull();
  },
);

run('does not resolve an expired card', async () => {
  const contract = await activeContract('expired@test.dev');
  await vault.save({
    ownerUserId: ownerId,
    contractId: contract.id,
    customerEmail: 'expired@test.dev',
    acquirerCode: 'DOM',
    token: 'tok_old',
    last4: '0001',
    expMonth: 1,
    expYear: 2026,
  });
  expect(
    await vault.resolveForContract(
      contract.id,
      'DOM',
      new Date('2026-02-02T00:00:00Z'),
    ),
  ).toBeNull();
  expect(
    (
      await vault.resolveForContract(
        contract.id,
        'DOM',
        new Date('2026-01-15T00:00:00Z'),
      )
    )?.token,
  ).toBe('tok_old');
});

run(
  'cycle executor charges the stored card; a retry reuses the same key',
  async () => {
    const contract = await activeContract('cycle@test.dev');
    await vault.save({
      ownerUserId: ownerId,
      contractId: contract.id,
      customerEmail: 'cycle@test.dev',
      acquirerCode: 'DOM',
      token: 'tok_cycle',
      last4: '4242',
      expMonth: 12,
      expYear: 2099,
    });
    const keys: string[] = [];
    const tokens: string[] = [];
    let timeout = true;
    const gateway = {
      chargeStoredCardToken: async (_t: string, input: any) => {
        // O banco é compartilhado entre os testes: só observa o cartão deste contrato.
        if (input.cardToken !== 'tok_cycle') return { status: 'paid' };
        keys.push(input.idempotencyKey);
        tokens.push(input.cardToken);
        if (timeout) throw new Error('timeout of 30000ms exceeded');
        return { id: 'p1', status: 'paid', amount: input.amount };
      },
    };
    const executor = new StoredCardCycleExecutor(db as never, vault, {
      capabilitiesFor: () => ({ chargeStoredCard: true }),
      byAcquirer: () => gateway,
    } as never);
    const first = await cycles.runDue(
      new Date(t0.getTime() + 31 * day),
      executor,
    );
    expect(first.unknown).toBeGreaterThanOrEqual(1);
    const pending = await db!.charge.findFirstOrThrow({
      where: { contractId: contract.id, status: 'PENDING' },
    });
    // Mesma tentativa reenviada com a mesma chave: o adquirente deduplica.
    timeout = false;
    const retry = await executor.charge({ charge: pending, contract });
    expect(retry.outcome).toBe('PAID');
    expect(keys[0]).toBe(keys[1]!);
    expect(keys[0]).toBe(`cycle:${pending.id}:1`);
    expect(tokens[0]).toBe('tok_cycle');
  },
);
