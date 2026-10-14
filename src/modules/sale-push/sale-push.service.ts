import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

const webPush: { sendNotification: (subscription: unknown, payload: string, options: unknown) => Promise<unknown> } = require('web-push');
export type BrowserSubscription = { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } };
type Delivery = { id: string; subscriptionId: string; transactionId: string; amount: string; endpoint: string; p256dh: string; auth: string; attempts: number };

export function validateSubscription(value: BrowserSubscription) {
  let url: URL;
  try { url = new URL(value?.endpoint); } catch { throw new BadRequestException('Assinatura inválida'); }
  const providers = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.apple.com'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !providers.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
    throw new BadRequestException('Provedor de push inválido');
  }
  if (!/^[A-Za-z0-9_-]{87,88}$/.test(value.keys?.p256dh ?? '') || !/^[A-Za-z0-9_-]{22,24}$/.test(value.keys?.auth ?? '') || value.endpoint.length > 4096) {
    throw new BadRequestException('Chaves de assinatura inválidas');
  }
}

@Injectable()
export class SalePushService {
  private processing = false;
  constructor(private readonly prisma: PrismaService) {}
  publicKey() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) throw new ServiceUnavailableException('Notificações não configuradas');
    return { data: { publicKey } };
  }
  async subscribe(userId: string, subscription: BrowserSubscription) {
    this.publicKey();
    validateSubscription(subscription);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${subscription.endpoint}, 0))`;
      await tx.$queryRaw`SELECT id FROM "PushSubscription" WHERE endpoint = ${subscription.endpoint} FOR UPDATE`;
      // Endpoint belongs to one device/account. Remove old queued deliveries on account change.
      await tx.$executeRaw`DELETE FROM "PushDelivery" WHERE "subscriptionId" IN (SELECT id FROM "PushSubscription" WHERE endpoint = ${subscription.endpoint} AND "userId" <> ${userId})`;
      await tx.$executeRaw`INSERT INTO "PushSubscription" (id, "userId", endpoint, p256dh, auth) VALUES (${randomUUID()}, ${userId}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}) ON CONFLICT (endpoint) DO UPDATE SET "userId" = EXCLUDED."userId", p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`;
    });
    return { data: { subscribed: true } };
  }
  async unsubscribe(userId: string, endpoint: string) {
    if (typeof endpoint !== 'string' || !endpoint) throw new BadRequestException('Endpoint obrigatório');
    await this.prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE "userId" = ${userId} AND endpoint = ${endpoint}`;
    return { data: { subscribed: false } };
  }
  @Interval(15000)
  async processPending() {
    if (this.processing || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return;
    this.processing = true;
    try {
    // Lease survives crashes, prevents concurrent workers sending same pending delivery.
    const deliveries = await this.prisma.$queryRaw<Delivery[]>`
      WITH claimed AS (
        SELECT id FROM "PushDelivery" WHERE status = 'PENDING' AND "nextAttemptAt" <= now()
        ORDER BY "nextAttemptAt" LIMIT 20 FOR UPDATE SKIP LOCKED
      ), leased AS (
        UPDATE "PushDelivery" d SET "nextAttemptAt" = now() + interval '5 minutes', attempts = attempts + 1
        FROM claimed WHERE d.id = claimed.id RETURNING d.*
      )
      SELECT l.id, l."subscriptionId", l.attempts, e."transactionId", e.amount::text, s.endpoint, s.p256dh, s.auth
      FROM leased l JOIN "SalePushEvent" e ON e.id = l."eventId"
      JOIN "PushSubscription" s ON s.id = l."subscriptionId"
      JOIN "User" u ON u.id = s."userId"
      WHERE s."userId" = e."userId" AND u."clientStatus"::text = 'APPROVED' AND u."isActive" AND NOT u."isPurged"`;
    for (const delivery of deliveries) await this.deliver(delivery);
    } finally { this.processing = false; }
  }
  async deliver(delivery: Delivery) {
    // Recheck before each send; a device may change accounts while a batch waits.
    const current = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT d.id FROM "PushDelivery" d
      JOIN "SalePushEvent" e ON e.id = d."eventId"
      JOIN "PushSubscription" s ON s.id = d."subscriptionId"
      JOIN "User" u ON u.id = s."userId"
      WHERE d.id = ${delivery.id} AND s."userId" = e."userId"
      AND s.p256dh = ${delivery.p256dh} AND s.auth = ${delivery.auth}
      AND u."clientStatus"::text = 'APPROVED' AND u."isActive" AND NOT u."isPurged"`;
    if (!current.length) return;
    try {
      await webPush.sendNotification({ endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
        JSON.stringify({ saleId: delivery.transactionId, amount: Number(delivery.amount) }),
        { TTL: 86400, timeout: 10000, vapidDetails: { subject: process.env.VAPID_SUBJECT, publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } });
      await this.prisma.$executeRaw`UPDATE "PushDelivery" SET status = 'SENT', error = NULL WHERE id = ${delivery.id}`;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await this.prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE id = ${delivery.subscriptionId} AND p256dh = ${delivery.p256dh} AND auth = ${delivery.auth}`;
        return;
      }
      const delay = Math.min(3600000, 30000 * 2 ** Math.min(delivery.attempts, 7));
      const retryAt = new Date(Date.now() + delay);
      const message = status ? `HTTP ${status}` : 'Falha temporária no provedor';
      await this.prisma.$executeRaw`UPDATE "PushDelivery" SET "nextAttemptAt" = ${retryAt}, error = ${message} WHERE id = ${delivery.id}`;
    }
  }
}
