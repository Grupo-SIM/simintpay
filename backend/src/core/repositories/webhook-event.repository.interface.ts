import { WebhookEvent } from '@prisma/client';

export const WEBHOOK_EVENT_REPOSITORY = Symbol('WEBHOOK_EVENT_REPOSITORY');

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
