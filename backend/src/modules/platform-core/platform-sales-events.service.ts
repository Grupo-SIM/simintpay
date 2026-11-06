import { whereTransactionPlatform } from './transaction-platform';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EmailService } from '../../infrastructure/email/email.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { Interval } from '@nestjs/schedule';
import { createHash, createHmac } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { decryptPlatformSecret } from '../platform-integrations/platform-secrets';
import type { PlatformContext } from './platform-context.service';
import type { ChargeItem } from '../offer/offer-fulfillment';
import {
  loadDeliveryAttachments,
  purchasedItemsByTransaction,
  resolveLinkDelivery,
  DEFAULT_DELIVERY_BODY,
} from '../../application/use-cases/payment-link/payment-link-delivery';
const OFFER_ITEM_TYPE = { MAIN: 'PRINCIPAL', BUMP: 'ORDER_BUMP' } as const;

/** Offer sale facts for the platform payload: items as sold (snapshot) plus offer/charge ids. */
async function offerSalesByTransaction(db: PrismaService, transactionIds: string[]) {
  const result = new Map<string, { offerId: string; chargeId: string; linkId: string; items: object[] }>();
  if (transactionIds.length === 0) return result;
  const charges = await db.charge.findMany({
    where: { transactionId: { in: transactionIds }, offerId: { not: null } },
    include: { offer: true },
  });
  for (const c of charges) {
    if (!c.transactionId || !c.offer) continue;
    const snapshotItems = ((c.snapshot ?? {}) as { items?: ChargeItem[] }).items;
    const items: ChargeItem[] = snapshotItems?.length
      ? snapshotItems
      : [{ role: 'MAIN', offerId: c.offer.id, title: c.offer.name, amountCents: c.offer.amountCents }];
    result.set(c.transactionId, {
      offerId: c.offer.id,
      chargeId: c.id,
      // Offers migrated from a legacy link keep the link id the platform already knows.
      linkId: c.offer.legacyType === 'PaymentLink' && c.offer.legacyId ? c.offer.legacyId : c.offer.id,
      items: items.map((i) => ({
        tipo: OFFER_ITEM_TYPE[i.role as 'MAIN' | 'BUMP'] ?? i.role,
        ...(i.role === 'MAIN' ? {} : { offerId: i.offerId }),
        titulo: i.title,
        valor: i.amountCents / 100,
      })),
    });
  }
  return result;
}
type Stored = {
  sequence: bigint;
  eventId: string;
  platformId: string;
  url: string;
  payload: object;
  attempts: number;
  deliveredAt: Date | null;
  emailDeliveredAt: Date | null;
};
/** Durable snapshots rebuilt from financial state/history; never trusts checkout-supplied amounts. */
@Injectable()
export class PlatformSalesEventsService {
  private running = false;
  private readonly logger = new Logger(PlatformSalesEventsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModuleRef,
  ) {}
  async history(c: PlatformContext, cursor: string) {
    if (cursor && !/^\d+$/.test(cursor)) throw new Error('Cursor inválido');
    const rows = await this.prisma.$queryRaw<
      Stored[]
    >`SELECT * FROM "PlatformSalesEvent" WHERE "platformId" = ${c.id} AND sequence > ${BigInt(cursor || '0')} ORDER BY sequence LIMIT 100`;
    return {
      events: rows.map((row) => row.payload),
      nextCursor: rows.length ? String(rows.at(-1)!.sequence) : null,
    };
  }
  @Interval(30_000)
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.capture();
      const rows = await this.prisma.$queryRaw<Stored[]>`WITH pending AS (
        SELECT sequence FROM "PlatformSalesEvent" WHERE ("deliveredAt" IS NULL OR (payload->>'event' = 'purchase_approved' AND "emailDeliveredAt" IS NULL))
        AND "nextAttemptAt" <= NOW() ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 50
      ) UPDATE "PlatformSalesEvent" e SET "nextAttemptAt" = NOW() + INTERVAL '2 minutes' FROM pending WHERE e.sequence = pending.sequence RETURNING e.*`;
      for (const row of rows) await this.deliver(row);
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error.message : 'Erro no outbox',
      );
    } finally {
      this.running = false;
    }
  }
  async capture() {
    const platforms = await this.prisma.platform.findMany({
      where: {
        isActive: true,
        integrations: {
          some: { key: 'WEBHOOK_SECRET', encryptedValue: { not: null } },
        },
      },
      include: { integrations: true, owner: true },
    });
    for (const p of platforms) {
      if (!p.owner.isActive || p.owner.isPurged) continue;
      let cursor = '';
      for (;;) {
        const transactions = await this.prisma.transaction.findMany({
          where: {
            userId: p.ownerUserId,
            id: { gt: cursor },
            OR: [
              { paymentLink: { plataformas: { has: p.tag } } },
              whereTransactionPlatform(p.tag),
            ],
          },
          include: {
            paymentLink: true,
            statusHistory: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: { id: 'asc' },
          take: 100,
        });
        const itemsByTx = await purchasedItemsByTransaction(
          this.prisma,
          transactions,
        );
        const offerSales = await offerSalesByTransaction(this.prisma, transactions.map((t) => t.id));
        for (const tx of transactions) {
          const url =
            tx.paymentLink?.webhookUrl ||
            p.integrations.find((i) => i.key === 'WEBHOOK_URL')?.url;
          if (!url) continue;
          const snapshots = tx.statusHistory.map((h) => ({
            status: String(h.toStatus),
            em: h.createdAt,
          }));
          snapshots.push({ status: String(tx.status), em: tx.updatedAt });
          if (tx.pixContent && tx.pixExpire)
            snapshots.unshift({ status: 'PIX_GENERATED', em: tx.createdAt });
          if (
            tx.pixExpire &&
            tx.pixExpire < new Date() &&
            ['PENDING', 'EXPIRED'].includes(tx.status)
          )
            snapshots.push({ status: 'EXPIRED', em: tx.pixExpire });
          for (const snapshot of snapshots) {
            const event = (
              {
                COMPLETED: 'purchase_approved',
                REFUNDED: 'purchase_refunded',
                CHARGEBACK: 'chargeback',
                IN_MEDIATION: 'refund_requested',
                FAILED: 'card_declined',
                EXPIRED: 'pix_expired',
                PIX_GENERATED: 'pix_generated',
              } as Record<string, string>
            )[snapshot.status];
            if (
              !event ||
              (event === 'card_declined' &&
                tx.paymentMethod !== 'CREDIT_CARD') ||
              (event === 'pix_expired' && tx.paymentMethod !== 'PIX')
            )
              continue;
            // Null liquid settlement is not an approved financial contract.
            if (
              ['purchase_approved', 'purchase_refunded', 'chargeback'].includes(
                event,
              ) &&
              tx.netAmount === null
            )
              continue;
            const eventId = createHash('sha256')
              .update(`${p.id}:${tx.id}:${event}`)
              .digest('hex');
            const payload = {
              eventId,
              occurredAt: snapshot.em.toISOString(),
              event,
              orderId: tx.id,
              linkId: tx.paymentLinkId ?? offerSales.get(tx.id)?.linkId ?? undefined,
              ...(offerSales.has(tx.id)
                ? { offerId: offerSales.get(tx.id)!.offerId, chargeId: offerSales.get(tx.id)!.chargeId }
                : {}),
              amountCents: tx.amount.mul(100).toNumber(),
              netAmountCents: tx.netAmount?.mul(100).toNumber() ?? 0,
              paymentMethod: tx.paymentMethod,
              phone: tx.customerPhone,
              customerEmail: tx.customerEmail,
              customerName: tx.customerName,
              tracking: tx.tracking ?? {},
              ...(itemsByTx.has(tx.id)
                ? { items: itemsByTx.get(tx.id) }
                : offerSales.has(tx.id)
                  ? { items: offerSales.get(tx.id)!.items }
                  : {}),
              ...(event === 'pix_generated'
                ? {
                    pixContent: tx.pixContent,
                    pixExpire: tx.pixExpire?.toISOString(),
                  }
                : {}),
            };
            await this.prisma
              .$executeRaw`INSERT INTO "PlatformSalesEvent" ("eventId", "platformId", url, payload) VALUES (${eventId}, ${p.id}, ${url}, ${JSON.stringify(payload)}::jsonb) ON CONFLICT ("eventId") DO NOTHING`;
          }
        }
        if (transactions.length < 100) break;
        cursor = transactions.at(-1)!.id;
      }
    }
  }
  private async deliver(row: Stored) {
    try {
      const platform = await this.prisma.platform.findUnique({
        where: { id: row.platformId },
        include: { owner: true },
      });
      if (
        !platform?.isActive ||
        !platform.owner.isActive ||
        platform.owner.isPurged
      )
        throw new Error('Plataforma/dono inativo');
      const config = await this.prisma.platformIntegration.findUnique({
        where: {
          platformId_key: { platformId: row.platformId, key: 'WEBHOOK_SECRET' },
        },
      });
      if (!config?.encryptedValue) throw new Error('WEBHOOK_SECRET ausente');
      const url = new URL(row.url);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Webhook exige HTTPS');
      const body = JSON.stringify(row.payload);
      const signature = createHmac(
        'sha256',
        decryptPlatformSecret(config.encryptedValue),
      )
        .update(body)
        .digest('hex');
      if (!row.deliveredAt) {
        const response = await fetch(url, {
          method: 'POST',
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'content-type': 'application/json',
            'x-simintpay-signature': signature,
          },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await this.prisma
          .$executeRaw`UPDATE "PlatformSalesEvent" SET "deliveredAt" = NOW(), attempts = attempts + 1, "lastError" = NULL WHERE "eventId" = ${row.eventId}`;
      }
      const payload = row.payload as { event: string; orderId: string };
      if (payload.event === 'purchase_approved' && !row.emailDeliveredAt) {
        const tx = await this.prisma.transaction.findUnique({
          where: { id: payload.orderId },
          include: { paymentLink: { include: { files: true } } },
        });
        const enabledAt = config.createdAt;
        const existedBeforeIntegration =
          tx && enabledAt && tx.createdAt < enabledAt;
        if (
          !existedBeforeIntegration &&
          tx?.status === 'COMPLETED' &&
          tx.paymentLink &&
          tx.customerEmail
        ) {
          // Pedido principal: produto + order bumps. Upsell/downsell: só o material da oferta.
          const delivery = await resolveLinkDelivery(
            this.prisma,
            tx.id,
            tx.paymentLink,
          );
          const attachments = await loadDeliveryAttachments(
            this.modules.get(StorageService, { strict: false }),
            delivery.files,
          );
          await this.modules
            .get(EmailService, { strict: false })
            .sendEbookAccessEmail({
              to: tx.customerEmail,
              customerName: tx.customerName || 'Cliente',
              title: delivery.title,
              body: delivery.body || DEFAULT_DELIVERY_BODY,
              redirectUrl: delivery.redirectUrl,
              attachments,
            });
        }
        await this.prisma
          .$executeRaw`UPDATE "PlatformSalesEvent" SET "emailDeliveredAt" = NOW() WHERE "eventId" = ${row.eventId}`;
      }
    } catch (error) {
      const delay = Math.min(
        3_600_000,
        1000 * 2 ** Math.min(row.attempts + 1, 12),
      );
      await this.prisma
        .$executeRaw`UPDATE "PlatformSalesEvent" SET attempts = attempts + 1, "nextAttemptAt" = ${new Date(Date.now() + delay)}, "lastError" = ${error instanceof Error ? error.message : 'Erro'} WHERE "eventId" = ${row.eventId}`;
    }
  }
}
