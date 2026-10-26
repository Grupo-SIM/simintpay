import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { decryptPlatformSecret } from '../platform-integrations/platform-secrets';

@Injectable()
export class CanonicalMerchantEventsWorker {
  private running = false;
  constructor(private readonly prisma: PrismaService) {}
  @Interval(30000)
  async run() {
    if (this.running) return;
    this.running = true;
    try { await this.capture(); await this.deliver(); }
    finally { this.running = false; }
  }
  async capture() {
    const credentials = await this.prisma.platformApiCredential.findMany({ where: { source: 'delivery', isActive: true }, include: { platform: { include: { owner: true } } } });
    for (const credential of credentials) {
      if (!credential.platform.isActive || !credential.platform.owner.isActive || credential.platform.owner.isPurged) continue;
      const merchant = await this.prisma.integrationMerchant.findUnique({ where: { id: credential.merchantId }, include: { user: true } });
      if (!merchant?.user.isActive || merchant.user.isPurged) continue;
      // New canonical payments carry an immutable credential reference. Never infer historical attribution.
      let cursor: string | undefined;
      for (;;) {
        const rows = await this.prisma.transaction.findMany({ where: { userId: merchant.userId, tracking: { path: ['delivery', 'credentialId'], equals: credential.id }, ...(cursor ? { id: { gt: cursor } } : {}) }, include: { statusHistory: { orderBy: { createdAt: 'asc' } } }, orderBy: { id: 'asc' }, take: 100 });
        for (const row of rows) {
          const tracking = row.tracking as { delivery: { idempotencyKey: string } };
          const statuses = [...row.statusHistory.map(h => ({ status: h.toStatus, updatedAt: h.createdAt })), { status: row.status, updatedAt: row.updatedAt }];
          for (const item of statuses) {
            if (item.status === 'DRAFT') continue;
            const eventId = `payment:${row.id}:${item.status}`;
            await this.prisma.canonicalMerchantEvent.upsert({ where: { eventId }, update: {}, create: { credentialId: credential.id, eventId, payload: {
              eventId, kind: 'payment.updated', platformId: credential.platformId, externalMerchantId: credential.externalCompanyId,
              transactionId: row.id, paymentId: row.externalPaymentId, requestId: tracking.delivery.idempotencyKey, status: item.status, updatedAt: item.updatedAt.toISOString(),
            } } });
          }
        }
        if (rows.length < 100) break;
        cursor = rows.at(-1)!.id;
      }
      const withdrawals = await this.prisma.withdrawRequest.findMany({ where: { userId: merchant.userId, platform: { in: [merchant.integrationKey, credential.platform.tag.toLowerCase()] }, integrationRequestId: { not: null }, integrationWebhookDeliveries: { some: { merchantId: merchant.id } } } });
      for (const row of withdrawals) {
        const prefix = `platform:${credential.platformId}:${merchant.id}:`;
        const requestId = row.integrationRequestId!.startsWith(prefix) ? row.integrationRequestId!.slice(prefix.length) : row.integrationRequestId;
        const eventId = `withdrawal:${row.id}:${row.status}`;
        await this.prisma.canonicalMerchantEvent.upsert({ where: { eventId }, update: {}, create: { credentialId: credential.id, eventId, payload: {
          eventId, kind: 'withdrawal.updated', platformId: credential.platformId, externalMerchantId: credential.externalCompanyId,
          withdrawalId: row.id, requestId, status: row.status, rejectionReason: row.rejectionReason, updatedAt: row.updatedAt.toISOString(),
        } } });
      }
    }
  }
  async deliver() {
    const target = process.env.SIM_DELIVERY_CANONICAL_WEBHOOK_URL?.trim();
    if (!target) return;
    const base = new URL(target);
    if (base.protocol !== 'https:' || base.username || base.password) return;
    const now = new Date();
    const rows = await this.prisma.canonicalMerchantEvent.findMany({ where: { deliveredAt: null, nextAttemptAt: { lte: now } }, include: { credential: { include: { platform: { include: { owner: true } }, profile: true } } }, orderBy: { createdAt: 'asc' }, take: 25 });
    for (const row of rows) {
      const { credential } = row;
      if (!credential.isActive || !credential.profile.isActive || !credential.platform.isActive || !credential.platform.owner.isActive || credential.platform.owner.isPurged) continue;
      const lease = await this.prisma.canonicalMerchantEvent.updateMany({ where: { id: row.id, deliveredAt: null, nextAttemptAt: { lte: now } }, data: { nextAttemptAt: new Date(Date.now() + 120000) } });
      if (!lease.count) continue;
      try {
        const raw = JSON.stringify(row.payload);
        const signature = createHmac('sha256', decryptPlatformSecret(credential.encryptedWebhookSecret)).update(raw).digest('hex');
        const response = await fetch(`${target.replace(/\/+$/, '')}/${encodeURIComponent(credential.externalCompanyId)}/events`, { method: 'POST', body: raw, redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-simintpay-signature': signature } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await this.prisma.canonicalMerchantEvent.update({ where: { id: row.id }, data: { deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      } catch {
        await this.prisma.canonicalMerchantEvent.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastError: 'Webhook delivery failed', nextAttemptAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(row.attempts + 1, 12))) } });
      }
    }
  }
}
