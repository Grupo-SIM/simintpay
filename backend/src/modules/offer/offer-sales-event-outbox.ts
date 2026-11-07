import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isPrivateAddress, unsafeUrlReason } from './offer-fulfillment';

export const OFFER_SALES_EVENT_OUTBOX = Symbol('OFFER_SALES_EVENT_OUTBOX');

export type OfferSalesEvent = {
  /** Platform that owns the webhook (`Offer.platformTag`). */
  platformTag: string | null;
  event: 'subscription_activated';
  /** Transaction id of the charge; with the platform and event it makes the delivery unique. */
  orderId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

/**
 * Queues a sales callback on the platform's durable outbox. Resolves `true` when the event was
 * stored OR there is nothing to deliver (no platform, no webhook configured, unsafe address);
 * rejects only on infrastructure errors so the caller can release its idempotency marker.
 */
export interface OfferSalesEventOutbox {
  enqueue(event: OfferSalesEvent): Promise<boolean>;
}

export type HostResolver = (host: string) => Promise<string[]>;

const resolveAll: HostResolver = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

/**
 * Same outbox `PlatformSalesEventsService` drains (signed, retried with backoff, HTTPS only).
 * The event id uses the same `sha256(platform:order:event)` recipe as its capture, so a repeat
 * never produces a second row.
 */
@Injectable()
export class PrismaOfferSalesEventOutbox implements OfferSalesEventOutbox {
  private readonly logger = new Logger(PrismaOfferSalesEventOutbox.name);
  /** Replaced in tests; production resolves through the system DNS. */
  resolve: HostResolver = resolveAll;

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(event: OfferSalesEvent): Promise<boolean> {
    if (!event.platformTag) return true;
    const platform = await this.prisma.platform.findUnique({
      where: { tag: event.platformTag },
      include: { integrations: true, owner: true },
    });
    if (
      !platform?.isActive ||
      !platform.owner.isActive ||
      platform.owner.isPurged
    )
      return true;
    const secret = platform.integrations.find(
      (i) => i.key === 'WEBHOOK_SECRET',
    );
    const url = platform.integrations.find((i) => i.key === 'WEBHOOK_URL')?.url;
    if (!secret?.encryptedValue || !url) return true;

    // SSRF barrier: static URL check plus the addresses the host resolves to right now.
    const reason = unsafeUrlReason(url);
    if (reason) return this.refuse(platform.tag, reason);
    const addresses = await this.resolve(new URL(url).hostname);
    if (addresses.length === 0 || addresses.some(isPrivateAddress))
      return this.refuse(platform.tag, 'host resolve para rede interna');

    const eventId = createHash('sha256')
      .update(`${platform.id}:${event.orderId}:${event.event}`)
      .digest('hex');
    const payload = {
      eventId,
      occurredAt: event.occurredAt.toISOString(),
      event: event.event,
      ...event.payload,
    };
    await this.prisma
      .$executeRaw`INSERT INTO "PlatformSalesEvent" ("eventId", "platformId", url, payload) VALUES (${eventId}, ${platform.id}, ${url}, ${JSON.stringify(payload)}::jsonb) ON CONFLICT ("eventId") DO NOTHING`;
    return true;
  }

  private refuse(tag: string, reason: string) {
    this.logger.warn(
      `[OfferSalesEvent] webhook de ${tag} bloqueado: ${reason}`,
    );
    return true;
  }
}
