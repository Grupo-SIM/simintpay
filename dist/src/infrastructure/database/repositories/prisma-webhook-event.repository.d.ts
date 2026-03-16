import { WebhookEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IWebhookEventRepository } from '../../../core/repositories/webhook-event.repository.interface';
export declare class PrismaWebhookEventRepository implements IWebhookEventRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findByEventId(eventId: string): Promise<WebhookEvent | null>;
    create(data: {
        eventId: string;
        source: string;
        eventType: string;
        payload: unknown;
    }): Promise<WebhookEvent>;
    markProcessed(id: string): Promise<void>;
    markFailed(id: string, error: string): Promise<void>;
}
