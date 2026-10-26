import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { IntegrationFinanceService } from './integration-finance.service';

interface PendingDelivery {
  attempts: number;
  id: string;
  payload: unknown;
  merchant: { externalMerchantId: string; integrationKey: string };
}

@Injectable()
export class IntegrationWebhookWorker {
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: IntegrationFinanceService,
  ) {}

  @Interval(30_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.finance.enqueueCurrentStatuses();
      const deliveries = await this.prisma.integrationWebhookDelivery.findMany({
        where: { deliveredAt: null, nextAttemptAt: { lte: new Date() } },
        include: { merchant: true },
        orderBy: { createdAt: 'asc' },
        take: 25,
      });
      for (const delivery of deliveries) await this.deliver(delivery);
    } finally {
      this.running = false;
    }
  }

  private async deliver(delivery: PendingDelivery): Promise<void> {
    const url = process.env.SIM_DELIVERY_WITHDRAWAL_WEBHOOK_URL?.trim();
    const secret = process.env.SIM_DELIVERY_WEBHOOK_SECRET?.trim();
    if (!url || !secret || !delivery.merchant.integrationKey.startsWith('sim-delivery_')) return;
    try {
      const body = JSON.stringify({ ...delivery.payload as object, externalMerchantId: delivery.merchant.externalMerchantId });
      const signature = createHmac('sha256', secret).update(body).digest('hex');
      const response = await fetch(url, {
        body,
        headers: { 'content-type': 'application/json', 'x-simpay-signature': signature },
        method: 'POST',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await this.prisma.integrationWebhookDelivery.update({
        where: { id: delivery.id },
        data: { attempts: { increment: 1 }, deliveredAt: new Date(), lastError: null },
      });
    } catch (error) {
      const attempts = delivery.attempts + 1;
      await this.prisma.integrationWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
          nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 2 ** Math.min(attempts, 10) * 1_000)),
        },
      });
    }
  }
}
