import { WebhookEvent } from '@prisma/client';
export declare const WEBHOOK_EVENT_REPOSITORY: unique symbol;
export interface IWebhookEventRepository {
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
