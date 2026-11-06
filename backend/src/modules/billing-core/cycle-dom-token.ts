import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

/**
 * DOM token a cycle charge is issued with for a contract owner. Single source of truth shared by
 * StoredCardCycleExecutor (issuing) and DomChargeStatusLookup (reconciling), so the lookup always
 * searches the same account the charge was created in.
 */
export async function resolveCycleDomToken(
  prisma: Pick<PrismaService, 'user'>,
  userId: string,
): Promise<string | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return undefined;
  return process.env.DOM_TOKEN;
}
