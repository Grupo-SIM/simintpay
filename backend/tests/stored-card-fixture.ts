import type { PrismaClient } from '@prisma/client';

/** Gives a contract an ACTIVE, unexpired stored card with a token for its acquirer (DOM by default). */
export async function giveStoredCard(
  db: PrismaClient,
  contract: { id: string; userId: string; customerEmail?: string | null },
  acquirerCode = 'DOM',
  expYear = 2099,
) {
  await db.acquirerCatalogue.upsert({
    where: { code: acquirerCode },
    update: {},
    create: { code: acquirerCode, name: acquirerCode },
  });
  return db.storedCard.create({
    data: {
      ownerUserId: contract.userId,
      contractId: contract.id,
      customerEmail: contract.customerEmail ?? 'buyer@test.dev',
      last4: '4242',
      expMonth: 12,
      expYear,
      tokens: { create: { acquirerCode, encryptedToken: 'enc:test' } },
    },
  });
}
