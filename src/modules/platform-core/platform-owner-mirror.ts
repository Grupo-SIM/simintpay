import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { PlatformContext } from './platform-context.service';

/** Compatibility projection only: never creates an owner, platform, or cash wallet. */
export class PlatformOwnerMirror {
  constructor(private readonly prisma: PrismaService) {}

  async sync(tag: string, context?: PlatformContext) {
    const lower = tag.toLowerCase();
    return this.prisma.$transaction(async p => {
      const platform = await p.platform.findFirst({
        where: { tag: { equals: lower, mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false } },
      });
      if (!platform) return { success: false, error: 'Plataforma não cadastrada com dono no admin' };
      if (context && (platform.id !== context.id || platform.ownerUserId !== context.ownerUserId)) throw new ConflictException('Contexto da plataforma mudou');
      const userId = platform.ownerUserId;
      const user = await p.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, cpf: true } });
      if (!user) return { success: false, error: `Usuário com id ${userId} não encontrado` };
      const wallet = await p.wallet.findUnique({ where: { userId } });
      const balance = Number(wallet?.balance ?? 0);
      const cpf = user.cpf ?? userId.replace(/-/g, '').slice(0, 11).padEnd(11, '0');
      const external = await p.externalPlatformUser.upsert({
        where: { cpf_platform: { cpf, platform: lower } },
        update: { name: user.name, userId: user.id, updatedAt: new Date() },
        create: { cpf, name: user.name, platform: lower, userId: user.id },
      });
      await p.externalPlatformWallet.upsert({ where: { externalUserId: external.id }, update: { balance }, create: { externalUserId: external.id, balance } });
      return { success: true, externalUserId: external.id, userId: user.id, name: user.name, platform: lower, balance };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
