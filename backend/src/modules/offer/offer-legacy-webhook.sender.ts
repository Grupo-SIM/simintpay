import { lookup } from 'node:dns/promises';
import { Injectable, Logger } from '@nestjs/common';
import {
  getPlatformIntegrationValue,
  getPlatformWebhookToken,
} from '../platform-integrations/platform-integrations.store';
import { isPrivateAddress, unsafeUrlReason } from './offer-fulfillment';
import {
  SIGNED_OUTBOX_EVENTS,
  offerWebhookUrl,
  type LegacyWebhookEvent,
} from './offer-legacy-webhook';

export type HostResolver = (host: string) => Promise<string[]>;
export type WebhookPost = (
  url: string,
  init: { headers: Record<string, string>; body: string },
) => Promise<{ status: number }>;

const resolveAll: HostResolver = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

const post: WebhookPost = (url, init) =>
  fetch(url, {
    method: 'POST',
    headers: init.headers,
    body: init.body,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });

/**
 * Sends the legacy link webhook of an offer. `send` resolves `true` when the callback was
 * delivered OR there is nothing to deliver (no URL, unsafe address, already covered by the
 * signed channel, receiver rejected it with a definitive 4xx); `false` asks the caller to retry
 * (network error, timeout, 5xx, 408/429). It never throws.
 */
@Injectable()
export class OfferLegacyWebhookSender {
  private readonly logger = new Logger(OfferLegacyWebhookSender.name);
  /** Replaced in tests; production resolves through the system DNS and `fetch`. */
  resolve: HostResolver = resolveAll;
  post: WebhookPost = post;

  /**
   * Where `event` of this offer goes through the legacy format, or null when there is nothing to
   * send. The offer's own `metadata.webhookUrl` wins; without one, the events the signed outbox
   * does not emit (renewal, expiry) use the platform `WEBHOOK_URL` (HTTPS) with the platform
   * `WEBHOOK_SECRET` as `x-simpay-token`. An event is never sent twice to the same URL.
   */
  target(
    offer: { platformTag: string | null; metadata: unknown },
    event: LegacyWebhookEvent,
  ): { url: string; token: string } | null {
    const tag = offer.platformTag;
    const own = offerWebhookUrl(offer);
    if (own) {
      if (this.coveredBySignedChannel(tag, event, own)) return null;
      return { url: own, token: getPlatformWebhookToken([tag]) };
    }
    // Signed events already reach the platform URL through the outbox (new body, same token).
    if (!tag || SIGNED_OUTBOX_EVENTS.has(event)) return null;
    const url = getPlatformIntegrationValue(tag, 'WEBHOOK_URL');
    const token = getPlatformIntegrationValue(tag, 'WEBHOOK_SECRET');
    if (!url || !token) {
      this.warnOnce(tag, 'sem WEBHOOK_URL/WEBHOOK_SECRET configurados');
      return null;
    }
    if (!url.toLowerCase().startsWith('https://')) {
      this.warnOnce(tag, 'WEBHOOK_URL não é HTTPS');
      return null;
    }
    return { url, token };
  }

  async send(
    offer: { id: string; platformTag: string | null; metadata: unknown },
    event: LegacyWebhookEvent,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    const target = this.target(offer, event);
    if (!target) return true;
    const { url, token } = target;
    try {
      // SSRF barrier: static URL check plus the addresses the host resolves to right now.
      const reason = unsafeUrlReason(url);
      if (reason) return this.refuse(offer.id, reason);
      const addresses = await this.resolve(new URL(url).hostname);
      if (addresses.length === 0 || addresses.some(isPrivateAddress))
        return this.refuse(offer.id, 'host resolve para rede interna');

      const response = await this.post(url, {
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-simpay-token': token } : {}),
        },
        body: JSON.stringify(body),
      });
      if (response.status >= 200 && response.status < 300) return true;
      const transient =
        response.status >= 500 ||
        response.status === 408 ||
        response.status === 429;
      this.logger.warn(
        `[OfferWebhook] ${event} da oferta ${offer.id} recusado com HTTP ${response.status}${transient ? ' (nova tentativa)' : ''}`,
      );
      return !transient;
    } catch (err: unknown) {
      this.logger.warn(
        `[OfferWebhook] ${event} da oferta ${offer.id} falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * The platform's signed outbox (HTTPS only) already delivers these events to the platform
   * `WEBHOOK_URL`; the same URL on the offer would receive them twice.
   */
  private coveredBySignedChannel(
    tag: string | null,
    event: LegacyWebhookEvent,
    url: string,
  ): boolean {
    if (!tag || !SIGNED_OUTBOX_EVENTS.has(event)) return false;
    if (!url.toLowerCase().startsWith('https://')) return false;
    return (
      Boolean(getPlatformIntegrationValue(tag, 'WEBHOOK_SECRET')) &&
      getPlatformIntegrationValue(tag, 'WEBHOOK_URL') === url
    );
  }

  private readonly warned = new Set<string>();
  private warnOnce(tag: string, reason: string) {
    if (this.warned.has(tag)) return;
    this.warned.add(tag);
    this.logger.warn(
      `[OfferWebhook] plataforma ${tag}: ${reason}; renovação/expiração não serão enviadas`,
    );
  }

  private refuse(offerId: string, reason: string) {
    this.logger.warn(
      `[OfferWebhook] webhook da oferta ${offerId} bloqueado: ${reason}`,
    );
    return true;
  }
}
