import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  sendLinkDelivery,
  type LinkDelivery,
  type PurchasedItem,
} from './offer-delivery';
import { recordVoucherUsageOnce } from '../../application/use-cases/voucher/voucher-offer';
import type { Charge, Offer, Transaction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import {
  onChargeSettled,
  type ChargeSettledEvent,
} from '../billing-core/charge-settlement';
import { isReactivationCharge } from '../billing-core/contract-advance';
import { readOfferFulfillment, type ChargeItem } from './offer-fulfillment';
import {
  OFFER_SALES_EVENT_OUTBOX,
  type OfferSalesEventOutbox,
} from './offer-sales-event-outbox';
import { subscriptionActivatedPayload } from './offer-subscription-event';
import {
  purchaseWebhookBody,
  subscriptionExpiredWebhookBody,
  subscriptionWebhookBody,
  type LegacyWebhookEvent,
} from './offer-legacy-webhook';
import { OfferLegacyWebhookSender } from './offer-legacy-webhook.sender';

export type DeliveryStep =
  | 'email'
  | 'subscriptionActivated'
  | 'webhookApproved'
  | 'webhookRefunded'
  | 'webhookActivated'
  | 'webhookRenewed'
  | 'webhookExpired';

/** Marker step of each legacy link webhook event. */
export const WEBHOOK_STEPS: Record<LegacyWebhookEvent, DeliveryStep> = {
  purchase_approved: 'webhookApproved',
  purchase_refunded: 'webhookRefunded',
  subscription_activated: 'webhookActivated',
  subscription_renewed: 'webhookRenewed',
  subscription_expired: 'webhookExpired',
};

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

/** Tempo para o commit de quem liquidou aparecer; depois disso desiste e registra. */
// Os últimos intervalos cobrem um receptor de webhook fora do ar por alguns minutos.
const RETRY_DELAYS_MS = [250, 1_000, 4_000, 15_000, 60_000, 300_000];

export type DeliveryOutcome = 'done' | 'retry' | 'skipped';

/**
 * Entrega da oferta paga: e-mail com arquivos/mensagem, reaproveitando os helpers do link legado. Idempotente por Charge.
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
    @Optional()
    @Inject(OFFER_SALES_EVENT_OUTBOX)
    private readonly outbox?: OfferSalesEventOutbox,
    @Optional() private readonly webhooks?: OfferLegacyWebhookSender,
  ) {}

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
              `[OfferFulfillment] Entrega da tx ${event.transactionId} ainda pendente após as tentativas; descartada`,
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
      voucher?: {
        voucherId: string;
        originalAmountCents: number;
        discountAmountCents: number;
        finalAmountCents: number;
      };
    };
    // O cupom só consome um uso depois do pagamento aprovado; repetir o evento não conta de novo.
    if (!refunded && snap.voucher?.voucherId)
      await this.recordVoucherUse(charge, tx, snap.voucher);
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

    // `subscription_activated`: quando o contrato é ATIVADO, isto é, no PRIMEIRO ciclo pago
    // (offer-subscribe, offer-checkout, webhook da DOM) e na cobrança de reativação de um
    // contrato suspenso (offer-renewal). Renovação de ciclo não reemite. Idempotente por
    // contrato e ativação: marcador na Charge mais o `eventId` do outbox. A liquidação do
    // líquido (netAmount) pode aparecer um instante depois; sem ele o passo tenta de novo.
    let activated = false;
    const recurring =
      !refunded && Boolean(charge.contractId) && offer.renewalMode !== 'NONE';
    if (recurring) {
      const first = await this.prisma.charge.findFirst({
        where: { contractId: charge.contractId!, status: 'PAID' },
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      activated = first?.id === charge.id || isReactivationCharge(charge);
      if (activated && this.outbox) {
        if (tx.netAmount === null) return 'retry';
        await this.once(charge.id, 'subscriptionActivated', () =>
          this.outbox!.enqueue({
            platformTag: offer.platformTag,
            event: 'subscription_activated',
            orderId: tx.id,
            occurredAt: charge.paidAt ?? new Date(),
            payload: subscriptionActivatedPayload({ offer, charge, tx }),
          }),
        );
      }
    }

    return (await this.notifyOfferWebhook({
      offer,
      charge,
      tx,
      delivery,
      refunded,
      recurring,
      activated,
    }))
      ? 'done'
      : 'retry';
  }

  /**
   * Webhook do link (`Offer.metadata.webhookUrl`), no mesmo corpo do link legado. Um passo por
   * Charge e evento (marcador + retentativa). Devolve false para tentar de novo.
   */
  private async notifyOfferWebhook(input: {
    offer: Offer;
    charge: Charge;
    tx: Transaction;
    delivery: LinkDelivery;
    refunded: boolean;
    recurring: boolean;
    activated: boolean;
  }): Promise<boolean> {
    const { offer, charge, tx, delivery, refunded } = input;
    if (!this.webhooks) return true;
    const oneOff = offer.renewalMode === 'NONE';
    let event: LegacyWebhookEvent;
    if (refunded) {
      if (!oneOff) return true;
      event = 'purchase_refunded';
    } else if (oneOff) event = 'purchase_approved';
    else if (input.recurring)
      event = input.activated
        ? 'subscription_activated'
        : 'subscription_renewed';
    else return true;
    if (!this.webhooks.target(offer, event)) return true;

    const body =
      event === 'purchase_approved' || event === 'purchase_refunded'
        ? purchaseWebhookBody({
            event,
            offer,
            charge,
            tx,
            // O pedido principal mantém o nome da oferta; só upsell/downsell traz o título dele.
            planName: delivery.kind === 'OFFER' ? delivery.title : offer.name,
            items: delivery.items,
          })
        : subscriptionWebhookBody({ event, offer, charge, tx });
    // Ciclo sem líquido liquidado ainda: espera (o líquido aparece logo depois da liquidação).
    if (event !== 'purchase_approved' && event !== 'purchase_refunded')
      if (tx.netAmount === null) return false;

    let failed = false;
    await this.once(charge.id, WEBHOOK_STEPS[event], async () => {
      const ok = await this.webhooks!.send(offer, event, body);
      if (!ok) failed = true;
      return ok;
    });
    return !failed;
  }

  /**
   * `subscription_expired`: contrato cancelado, suspenso ou encerrado. Marcador no último ciclo
   * pago (uma reativação paga abre um novo ciclo e permite avisar de novo).
   */
  async notifyContractExpired(contractId: string): Promise<boolean> {
    if (!this.webhooks) return true;
    const contract = await this.prisma.billingContract.findUnique({
      where: { id: contractId },
      include: { offer: true },
    });
    if (
      !contract?.offer ||
      !this.webhooks.target(contract.offer, 'subscription_expired')
    )
      return true;
    const last = await this.prisma.charge.findFirst({
      where: { contractId, status: 'PAID' },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!last) return true;
    const tx = last.transactionId
      ? await this.prisma.transaction.findUnique({
          where: { id: last.transactionId },
          select: { paymentMethod: true },
        })
      : null;
    const body = subscriptionExpiredWebhookBody({
      offer: contract.offer,
      contract,
      paymentMethod: tx?.paymentMethod,
    });
    let failed = false;
    await this.once(last.id, WEBHOOK_STEPS.subscription_expired, async () => {
      const ok = await this.webhooks!.send(
        contract.offer!,
        'subscription_expired',
        body,
      );
      if (!ok) failed = true;
      return ok;
    });
    return !failed;
  }

  private async recordVoucherUse(
    charge: { customerEmail: string | null; customerDocument: string | null },
    tx: {
      id: string;
      customerEmail: string | null;
      customerDocument: string | null;
    },
    voucher: {
      voucherId: string;
      originalAmountCents: number;
      discountAmountCents: number;
      finalAmountCents: number;
    },
  ) {
    try {
      await recordVoucherUsageOnce(this.prisma as never, {
        voucherId: voucher.voucherId,
        transactionId: tx.id,
        customerEmail: charge.customerEmail ?? tx.customerEmail ?? '',
        customerDocument: charge.customerDocument ?? tx.customerDocument ?? '',
        originalAmount: voucher.originalAmountCents / 100,
        discountAmount: voucher.discountAmountCents / 100,
        finalAmount: voucher.finalAmountCents / 100,
      });
    } catch (err: unknown) {
      this.logger.error(
        `[OfferFulfillment] Uso do cupom não registrado (tx=${tx.id}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

  /** Compõe a entrega (principal + bumps, ou só o upsell/downsell) a partir das ofertas. */
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
