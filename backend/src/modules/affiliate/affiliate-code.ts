import { randomBytes } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { generateAffiliateCode } from './affiliate';

/** Stable per (platform, person); created the first time the person joins any list. */
export async function ensureAffiliateCode(
  tx: Prisma.TransactionClient,
  platformId: string,
  userId: string,
): Promise<string> {
  const existing = await tx.$queryRaw<
    { code: string }[]
  >`SELECT code FROM "AffiliateCode" WHERE "platformId" = ${platformId} AND "userId" = ${userId}`;
  if (existing.length) return existing[0].code;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateAffiliateCode(randomBytes);
    const inserted =
      await tx.$executeRaw`INSERT INTO "AffiliateCode" ("platformId", "userId", code) VALUES (${platformId}, ${userId}, ${code}) ON CONFLICT DO NOTHING`;
    if (inserted) return code;
  }
  throw new ConflictException('Não foi possível gerar o código do afiliado');
}
