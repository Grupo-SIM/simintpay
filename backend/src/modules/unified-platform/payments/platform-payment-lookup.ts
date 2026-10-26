import { hasPlatformMarker } from '../../platform-core/platform-sync.adapter';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

export class PlatformPaymentLookup {
  constructor(private readonly prisma: PrismaService) {}
  async find(context: { tag: string; id?: string; ownerUserId?: string }, reference: string, merchantUserId?: string) {
    const platform = await this.prisma.platform.findUnique({ where: { tag: context.tag }, include: { owner: true } });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    if (!platform.isActive || !platform.owner.isActive || platform.owner.isPurged ||
      (context.id && context.id !== platform.id) || (context.ownerUserId && context.ownerUserId !== platform.ownerUserId)) throw new ForbiddenException('Plataforma ou dono alterado/inativo');
    const payment = await this.prisma.transaction.findFirst({ where: {
      acquirer: platform.acquirer, ...(merchantUserId ? { userId: merchantUserId } : {}),
      AND: [
        { OR: [{ description: { contains: `[TENANT:${platform.tag}]` } }, { description: { contains: `[TENANT:${platform.tag.replaceAll('-', '_')}]` } }] },
        { OR: [{ id: reference }, { domPaymentId: reference }, { domTransactionId: reference }, { externalPaymentId: reference }] },
      ],
    } });
    return payment && hasPlatformMarker(payment.description, platform.tag) ? payment : null;
  }
}
