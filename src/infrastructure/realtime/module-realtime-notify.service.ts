import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma/prisma.service';
import { BosqueEventsService } from '../../modules/bosque/events/bosque-events.service';
import { RenovadaEventsService } from '../../modules/renovada/events/renovada-events.service';

/**
 * Encaminha eventos de saque para o stream SSE do módulo do usuário (Renovada vs Bosque).
 */
@Injectable()
export class ModuleRealtimeNotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bosqueEvents: BosqueEventsService,
    private readonly renovadaEvents: RenovadaEventsService,
  ) {}

  async notifyWithdrawal(userId: string, payload: Record<string, unknown> = {}): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenantModule: true },
    });
    const slug = user?.tenantModule?.slug?.toLowerCase() ?? 'renovada';
    const data = { userId, ...payload };
    if (slug === 'bosque') {
      this.bosqueEvents.emitWithdrawal(data);
    } else {
      this.renovadaEvents.emitWithdrawal(data);
    }
  }
}
