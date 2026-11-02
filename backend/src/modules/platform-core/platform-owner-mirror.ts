import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { PlatformContext } from './platform-context.service';

/** Read-only compatibility response. Never copies pooled funds into a platform wallet. */
export class PlatformOwnerMirror {
  constructor(private readonly prisma: PrismaService) {}

  async sync(tag: string, context?: PlatformContext) {
    const lower = tag.toLowerCase();
    return this.prisma.$transaction(
      async (p) => {
        const platform = await p.platform.findFirst({
          where: {
            tag: { equals: lower, mode: 'insensitive' },
            isActive: true,
            owner: { isActive: true, isPurged: false },
          },
        });
        if (!platform)
          return {
            success: false,
            error: 'Plataforma não cadastrada com dono no admin',
          };
        if (
          context &&
          (platform.id !== context.id ||
            platform.ownerUserId !== context.ownerUserId)
        )
          throw new ConflictException('Contexto da plataforma mudou');
        const userId = platform.ownerUserId;
        const user = await p.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, cpf: true },
        });
        if (!user)
          return {
            success: false,
            error: `Usuário com id ${userId} não encontrado`,
          };
        const wallet = await p.wallet.findUnique({ where: { userId } });
        // Missing ordinary wallet is unknown (null), never a known zero.
        const external = await p.externalPlatformUser.findFirst({
          where: { userId, platform: lower },
        });
        return {
          success: true,
          externalUserId: external?.id ?? null,
          userId: user.id,
          name: user.name,
          platform: lower,
          balance: wallet ? Number(wallet.balance) : null,
          balanceScope: 'USER_WALLET_AGGREGATE',
          platformBalanceKnown: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
