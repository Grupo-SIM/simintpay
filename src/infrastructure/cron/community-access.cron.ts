import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma/prisma.service';

@Injectable()
export class CommunityAccessCron {
  private readonly logger = new Logger(CommunityAccessCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async reconcileCommunityAccess() {
    const now = new Date();
    const accesses = await this.prisma.communityAccess.findMany({
      where: { isActive: true },
    });

    let expired = 0;
    for (const access of accesses) {
      if (access.expiresAt <= now) {
        await this.prisma.communityAccess.update({
          where: { id: access.id },
          data: {
            isActive: false,
            status: 'PLANO_ENCERRADO',
            statusReason: 'Expirado por cron diário',
          },
        });
        await this.prisma.communitySubscriptionEvent.create({
          data: {
            communityId: access.communityId,
            userId: access.userId,
            eventType: 'EXPIRED',
            metadata: { source: 'cron-daily' },
          },
        });
        expired++;
      }
    }

    this.logger.log(`Cron de comunidades processado. Ativos: ${accesses.length}, expirados: ${expired}`);
  }
}
