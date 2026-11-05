import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { BUYER_NOTIFIER, type BuyerNotifier } from './buyer-notifier';

const MAX_ATTEMPTS = 5;

/** Entrega os eventos CHARGE_DUE pendentes ao comprador via BuyerNotifier. */
@Injectable()
export class ChargeDueDeliveryService {
  private readonly logger = new Logger(ChargeDueDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BUYER_NOTIFIER) private readonly notifier: BuyerNotifier,
  ) {}

  async deliverPending(): Promise<{ delivered: number; failed: number }> {
    const events = await this.prisma.billingContractEvent.findMany({
      where: {
        type: 'CHARGE_DUE',
        deliveredAt: null,
        attempts: { lt: MAX_ATTEMPTS },
      },
      include: { contract: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    let delivered = 0;
    let failed = 0;
    for (const event of events) {
      const payload = (event.payload ?? {}) as {
        chargeId?: string;
        amountCents?: number;
      };
      try {
        await this.notifier.chargeDue({
          contractId: event.contractId,
          chargeId: payload.chargeId ?? '',
          amountCents: payload.amountCents ?? 0,
          customerEmail: event.contract.customerEmail,
        });
        const marked = await this.prisma.billingContractEvent.updateMany({
          where: { id: event.id, deliveredAt: null },
          data: { deliveredAt: new Date(), attempts: { increment: 1 } },
        });
        if (marked.count > 0) delivered++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Falha ao entregar ${event.eventKey}: ${message}`);
        await this.prisma.billingContractEvent.update({
          where: { id: event.id },
          data: { attempts: { increment: 1 }, lastError: message },
        });
      }
    }
    return { delivered, failed };
  }
}
