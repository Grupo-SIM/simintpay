import type { PrismaClient } from '@prisma/client';

const lane = (rate: number, fixed: number) => ({
  active: true,
  contract: {
    fixedCents: fixed,
    ratePpm: rate,
    interestPpm: 0,
    cashbackCents: 0,
    base: 'ORIGINAL',
    reference: 'billing-test',
  },
  sim: { fixedCents: fixed, ratePpm: rate, interestPpm: 0 },
});

/** GLOBAL financial policy for DOM PIX (1% + R$0.50) and card (3% + R$1.00), ONLINE channel. */
export async function seedGlobalPolicy(db: PrismaClient) {
  const document = {
    schemaVersion: 1,
    lanes: {
      'DOM/PIX/ONLINE/1': lane(10_000, 50),
      'DOM/CREDIT_CARD/ONLINE/1': lane(30_000, 100),
    },
    owner: {},
  };
  const existing = await db.financialPolicyRevision.findFirst({
    where: { tag: 'GLOBAL', version: 1 },
  });
  if (existing) {
    await db.financialPolicyRevision.update({
      where: { id: existing.id },
      data: { document },
    });
    return;
  }
  const actor = await db.user.create({
    data: {
      name: 'Policy actor',
      email: `policy-${crypto.randomUUID()}@test.dev`,
      password: 'x',
    },
  });
  await db.financialPolicyRevision.create({
    data: { tag: 'GLOBAL', version: 1, actorId: actor.id, document },
  });
}
