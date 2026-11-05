import { lookup } from 'node:dns/promises';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { splitDocument } from '../../application/utils/document.util';
import {
  sendLinkDelivery,
  type LinkDelivery,
  type PurchasedItem,
} from '../../application/use-cases/payment-link/payment-link-delivery';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import {
  onChargeSettled,
  type ChargeSettledEvent,
} from '../billing-core/charge-settlement';
import {
  isPrivateAddress,
  readOfferFulfillment,
  unsafeUrlReason,
  type ChargeItem,
} from './offer-fulfillment';

export type DeliveryStep = 'email' | 'webhookApproved' | 'webhookRefunded';

/** Marcador de entrega por Charge (`Charge.snapshot.fulfillment.<step>`). */
export interface FulfillmentMarkers {
  /** true quando este chamador ganhou o passo; false se outro já o fez/está fazendo. */
  claim(chargeId: string, step: DeliveryStep): Promise<boolean>;
  release(chargeId: string, step: DeliveryStep): Promise<void>;
}

@Injectable()
export class PrismaFulfillmentMarkers implements FulfillmentMarkers {
  constructor(private readonly prisma: PrismaService) {}

  async claim(chargeId: string, step: DeliveryStep) {
    const changed = await this.prisma.$executeRaw`
      UPDATE "Charge"
      SET "snapshot" = jsonb_set(
        jsonb_set(COALESCE("snapshot", '{}'::jsonb), '{fulfillment}', COALESCE("snapshot"->'fulfillment', '{}'::jsonb)),
        ARRAY['fulfillment', ${step}]::text[],
        to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      )
      WHERE "id" = ${chargeId} AND ("snapshot" #> ARRAY['fulfillment', ${step}]::text[]) IS NULL`;
    return changed === 1;
  }

  async release(chargeId: string, step: DeliveryStep) {
    await this.prisma.$executeRaw`
      UPDATE "Charge"
      SET "snapshot" = "snapshot" #- ARRAY['fulfillment', ${step}]::text[]
      WHERE "id" = ${chargeId}`;
  }
}

export type WebhookTransport = {
  fetch: typeof fetch;
  /** Resolve o host; usado para barrar nomes que apontam para rede interna. */
  resolve(host: string): Promise<string[]>;
};

const defaultTransport: WebhookTransport = {
  fetch: (...args) => fetch(...args),
  resolve: async (host) =>
    (await lookup(host, { all: true })).map((r) => r.address),
};

/** Tempo para o commit de quem liquidou aparecer; depois disso desiste e registra. */
const RETRY_DELAYS_MS = [250, 1_000, 4_000, 15_000];

export type DeliveryOutcome = 'done' | 'retry' | 'skipped';

/**
 * Entrega da oferta paga: e-mail com arquivos/mensagem e webhook `purchase_approved` /
 * `purchase_refunded`, reaproveitando os helpers do link legado. Idempotente por Charge.
 */
@Injectable()
export class OfferFulfillmentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfferFulfillmentService.name);
  private off: (() => void) | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PrismaFulfillmentMarkers)
    private readonly markers: FulfillmentMarkers,
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  /** Substituível nos testes; em produção usa fetch e o DNS do sistema. */
  transport: WebhookTransport = defaultTransport;

  onModuleInit() {
    this.off = onChargeSettled((event) => this.schedule(event));
  }

  onModuleDestroy() {
    this.off?.();
    for (const t of this.timers) clearTimeout(t);
  }

  /** Agenda a entrega para depois do commit de quem liquida (o ouvinte roda dentro dele). */
  schedule(event: ChargeSettledEvent, attempt = 0) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.deliver(event)
        .then((outcome) => {
          if (outcome === 'retry' && attempt + 1 < RETRY_DELAYS_MS.length)
            this.schedule(event, attempt + 1);
          else if (outcome === 'retry')
            this.logger.warn(
              `[OfferFulfillment] Charge da tx ${event.transactionId} não ficou visível; entrega descartada`,
            );
        })
        .catch((err: unknown) =>
          this.logger.error(
            `[OfferFulfillment] Falha (tx=${event.transactionId}): ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }, RETRY_DELAYS_MS[attempt]);
    timer.unref?.();
    this.timers.add(timer);
  }

  async deliver(event: ChargeSettledEvent): Promise<DeliveryOutcome> {
    const charge = await this.prisma.charge.findUnique({
      where: { transactionId: event.transactionId },
    });
    if (!charge?.offerId) return 'skipped';
    const tx = await this.prisma.transaction.findUnique({
      where: { id: event.transactionId },
    });
    if (!tx) return 'skipped';
    const refunded = event.kind === 'REFUNDED';
    // Só age depois que o commit de quem liquidou ficou visível.
    if (!refunded && charge.status !== 'PAID') return 'retry';
    if (refunded && !['REFUNDED', 'CHARGEBACK'].includes(tx.status))
      return 'retry';

    const snap = (charge.snapshot ?? {}) as {
      items?: ChargeItem[];
      parentChargeId?: string;
    };
    const offer = await this.prisma.offer.findUnique({
      where: { id: charge.offerId },
    });
    if (!offer) return 'skipped';
    const items: ChargeItem[] = snap.items?.length
      ? snap.items
      : [
          {
            role: 'MAIN',
            offerId: offer.id,
            title: offer.name,
            amountCents: offer.amountCents,
          },
        ];
    const delivery = await this.buildDelivery(offer, items);

    // Upsell/downsell sem webhook próprio herdam o da oferta principal (como o link legado).
    let webhookUrl = readOfferFulfillment(offer.fulfillment).webhookUrl;
    if (!webhookUrl && snap.parentChargeId) {
      const parent = await this.prisma.charge.findUnique({
        where: { id: snap.parentChargeId },
        include: { offer: true },
      });
      webhookUrl = readOfferFulfillment(parent?.offer?.fulfillment).webhookUrl;
    }

    if (!refunded && charge.customerEmail && this.email) {
      await this.once(charge.id, 'email', async () => {
        const sent = await sendLinkDelivery(
          { email: this.email!, storage: this.storage, logger: this.logger },
          {
            email: charge.customerEmail!,
            name: charge.customerName,
            transactionId: tx.id,
          },
          delivery,
        );
        return sent;
      });
    }

    if (webhookUrl) {
      const payload = {
        event: refunded ? 'purchase_refunded' : 'purchase_approved',
        customerEmail: charge.customerEmail,
        customerName: charge.customerName,
        // Pedido principal mantém o nome da oferta (plataformas mapeiam o plano por ele).
        planName: delivery.kind === 'OFFER' ? delivery.title : offer.name,
        items: delivery.items,
        paymentMethod: String(tx.paymentMethod),
        amountCharged: Number(tx.amount),
        netAmount: Number(Number(tx.netAmount ?? tx.amount).toFixed(2)),
        orderId: tx.id,
        offerId: offer.id,
        chargeId: charge.id,
        linkId:
          offer.legacyType === 'PaymentLink' && offer.legacyId
            ? offer.legacyId
            : offer.id,
        ...splitDocument(charge.customerDocument),
        phone: tx.customerPhone ?? undefined,
      };
      await this.once(
        charge.id,
        refunded ? 'webhookRefunded' : 'webhookApproved',
        () => this.postWebhook(webhookUrl!, payload),
      );
    }
    return 'done';
  }

  /** Executa o passo uma vez por Charge; falha devolve o marcador para uma nova tentativa. */
  private async once(
    chargeId: string,
    step: DeliveryStep,
    run: () => Promise<boolean>,
  ) {
    if (!(await this.markers.claim(chargeId, step))) return;
    try {
      if (!(await run())) await this.markers.release(chargeId, step);
    } catch (err: unknown) {
      await this.markers.release(chargeId, step);
      this.logger.warn(
        `[OfferFulfillment] ${step} falhou (charge=${chargeId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** POST do webhook com o mesmo cabeçalho do legado e barreira de SSRF (URL + DNS). */
  private async postWebhook(
    url: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const reason = unsafeUrlReason(url);
    if (reason) throw new Error(`webhook bloqueado: ${reason}`);
    const host = new URL(url).hostname;
    const addresses = await this.transport.resolve(host);
    if (addresses.length === 0 || addresses.some(isPrivateAddress))
      throw new Error('webhook bloqueado: host resolve para rede interna');
    const res = await this.transport.fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json',
        'x-simpay-token': process.env.SIMPAY_WEBHOOK_TOKEN ?? '',
      },
      body: JSON.stringify(payload),
    });
    if (res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return true;
  }

  /** Mesma composição de `resolveLinkDelivery`, mas lendo ofertas em vez de PaymentLinkOffer. */
  private async buildDelivery(
    main: {
      id: string;
      name: string;
      amountCents: number;
      fulfillment: unknown;
    },
    items: ChargeItem[],
  ): Promise<LinkDelivery> {
    // Ofertas desativadas depois da venda continuam sendo entregues (o comprador pagou por elas).
    const rows = await this.prisma.offer.findMany({
      where: { id: { in: items.map((i) => i.offerId) } },
    });
    const byId = new Map(rows.map((o) => [o.id, o]));
    const fulfillmentOf = (id: string) =>
      readOfferFulfillment(
        id === main.id ? main.fulfillment : byId.get(id)?.fulfillment,
      );
    const purchased = (i: ChargeItem): PurchasedItem => ({
      tipo:
        i.role === 'MAIN'
          ? 'PRINCIPAL'
          : i.role === 'BUMP'
            ? 'ORDER_BUMP'
            : i.role,
      offerId: i.role === 'MAIN' ? undefined : i.offerId,
      titulo: i.title,
      valor: i.amountCents / 100,
    });

    const funnel = items.find(
      (i) => i.role === 'UPSELL' || i.role === 'DOWNSELL',
    );
    if (funnel) {
      const f = fulfillmentOf(funnel.offerId);
      return {
        kind: 'OFFER',
        title: funnel.title,
        body: f.emailBody,
        redirectUrl: null,
        files: f.files,
        items: [purchased(funnel)],
      };
    }

    const mainItem = items.find((i) => i.role === 'MAIN');
    const bumps = items.filter((i) => i.role === 'BUMP');
    const mainF = fulfillmentOf(main.id);
    const sections: string[] = [];
    if (mainF.emailBody) sections.push(mainF.emailBody);
    for (const b of bumps) {
      const body = fulfillmentOf(b.offerId).emailBody;
      if (body) sections.push(`— ${b.title} —\n${body}`);
    }
    return {
      kind: 'MAIN',
      title: bumps.length
        ? `${main.name} + ${bumps.map((b) => b.title).join(' + ')}`
        : main.name,
      body: sections.join('\n\n') || null,
      redirectUrl: mainF.redirectUrl,
      files: [
        ...mainF.files,
        ...bumps.flatMap((b) => fulfillmentOf(b.offerId).files),
      ],
      items: [
        purchased(
          mainItem ?? {
            role: 'MAIN',
            offerId: main.id,
            title: main.name,
            amountCents: main.amountCents,
          },
        ),
        ...bumps.map(purchased),
      ],
    };
  }
}
