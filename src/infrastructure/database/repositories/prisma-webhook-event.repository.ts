import { Injectable } from '@nestjs/common';
import { WebhookEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IWebhookEventRepository } from '../../../core/repositories/webhook-event.repository.interface';

@Injectable()
export class PrismaWebhookEventRepository implements IWebhookEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEventId(eventId: string): Promise<WebhookEvent | null> {
    return this.prisma.webhookEvent.findUnique({ where: { eventId } });
  }

  async create(data: {
    eventId: string;
    source: string;
    eventType: string;
    payload: unknown;
  }): Promise<WebhookEvent> {
    return this.prisma.webhookEvent.upsert({
      where: { eventId: data.eventId },
      update: {},
      create: {
        eventId: data.eventId,
        source: data.source,
        eventType: data.eventType,
        payload: data.payload as never,
      },
    });
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: 'PROCESSED', processedAt: new Date(), error: null },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status: 'FAILED',
        error,
        retryCount: { increment: 1 },
      },
    });
  }
}
