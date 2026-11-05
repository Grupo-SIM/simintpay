import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { getModuleDomToken } from '../module.registry';

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
    select: {
      domToken: true,
      clientStatus: true,
      platform: { select: { tag: true } },
    },
  });
  if (!user) return undefined;
  return user.clientStatus
    ? process.env.DOM_TOKEN
    : (user.domToken ??
        getModuleDomToken(user.platform?.tag) ??
        process.env.DOM_TOKEN);
}
