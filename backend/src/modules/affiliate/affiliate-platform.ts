import type { Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Same platform resolution as the coproduction capture: the offer's tag, else its owner's platform. */
export async function platformIdOfOffer(
  db: Db,
  offerId: string,
  platformTag?: string,
): Promise<string | null> {
  if (!platformTag) {
    const rows = await db.$queryRaw<
      { tag: string | null }[]
    >`SELECT coalesce(p."platformTag", fallback.tag) AS tag FROM "Offer" p JOIN "User" u ON u.id = p."ownerUserId" LEFT JOIN "Platform" fallback ON fallback.id = u."platformId" WHERE p.id = ${offerId}`;
    platformTag = rows[0]?.tag ?? undefined;
  }
  if (
    !platformTag ||
    ['GLOBAL', 'SIMINTPAY'].includes(platformTag.toUpperCase())
  )
    return null;
  const platforms = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Platform" WHERE tag = ${platformTag.toUpperCase()} AND "isActive" = true`;
  return platforms[0]?.id ?? null;
}
