import { UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

export async function requireExclusivePlatformWallet(prisma: PrismaService, userId: string, tag: string): Promise<void> {
  const platforms = await prisma.platform.findMany({ where: { ownerUserId: userId }, select: { tag: true } });
  if (platforms.length !== 1 || platforms[0].tag !== tag) {
    throw new UnprocessableEntityException({ code: 'SHARED_WALLET_MAINTENANCE_FORBIDDEN', message: 'Carteira sem vínculo exclusivo; manutenção bloqueada' });
  }
}
