import { Injectable } from '@nestjs/common';
import {
  firstChargeOutcome,
  type CardTokenSource,
  type FirstCardChargeInput,
  type FirstCardChargeResult,
} from './card-token-source';
import { markPreDispatchNoCharge } from '../unified-platform/payments/dom-rejection';
import { ExternalRefService } from './external-ref.service';

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value
    ? value
    : typeof value === 'number'
      ? String(value)
      : null;

/** Reads `card.token` from a DOM subscription (also tries the nested payment-method shapes). */
export function extractSubscriptionCardToken(
  subscription: unknown,
): string | null {
  const root = asObject(subscription);
  if (!root) return null;
  const candidates = [
    asObject(root.card),
    asObject(asObject(root.payment_method)?.card),
    asObject(asObject(root.paymentMethod)?.card),
    asObject(root.credit_card),
  ];
  for (const candidate of candidates) {
    const token = asString(candidate?.token);
    if (token) return token;
  }
  return null;
}

function transactionIdOf(subscription: Record<string, unknown>): string | null {
  for (const key of [
    'transaction',
    'last_transaction',
    'lastTransaction',
    'payment',
  ]) {
    const id = asString(asObject(subscription[key])?.id);
    if (id) return id;
  }
  return asString(subscription.transaction_id);
}

/**
 * Preferred source: the first charge is a DOM subscription (plan with a single repetition,
 * so DOM never recharges on its own) and the reusable token is read from the subscription's
 * `card.token`. UNVERIFIED against the real DOM: field names and whether the token survives
 * outside the subscription must be confirmed in sandbox.
 */
@Injectable()
export class SubscriptionCardTokenSource implements CardTokenSource {
  readonly kind = 'subscription' as const;

  constructor(private readonly refs: ExternalRefService) {}

  async chargeFirstCycle(
    input: FirstCardChargeInput,
  ): Promise<FirstCardChargeResult> {
    // Plan creation happens before any charge: a failure here is safe to retry.
    const planId = await this.planId(input).catch((error: unknown) => {
      throw error instanceof Error ? markPreDispatchNoCharge(error) : error;
    });
    const created = await input.gateway.createSubscriptionFromCheckout(
      input.domToken,
      { planId, customer: input.customer, card: input.card },
    );
    await this.refs.link(input.acquirerCode, 'SUBSCRIPTION', created.id, {
      entityType: 'BillingContract',
      entityId: input.contractId,
    });
    const paymentId =
      transactionIdOf(created as Record<string, unknown>) ??
      `sub:${created.id}`;
    const status = created.status;
    const token =
      firstChargeOutcome(status) === 'PAID'
        ? await this.readToken(input.gateway, input.domToken, created.id)
        : null;
    return { paymentId, status, token };
  }

  async fetchToken(input: {
    gateway: FirstCardChargeInput['gateway'];
    domToken: string;
    acquirerCode: string;
    contractId: string;
  }): Promise<string | null> {
    const subscriptionId = await this.refs.externalIdFor(
      { entityType: 'BillingContract', entityId: input.contractId },
      input.acquirerCode,
      'SUBSCRIPTION',
    );
    if (!subscriptionId) return null;
    return this.readToken(input.gateway, input.domToken, subscriptionId);
  }

  private async readToken(
    gateway: FirstCardChargeInput['gateway'],
    domToken: string,
    subscriptionId: string,
  ): Promise<string | null> {
    return extractSubscriptionCardToken(
      await gateway.getSubscription(domToken, subscriptionId),
    );
  }

  /** One single-repetition DOM plan per offer and gross amount, remembered in ExternalRef. */
  private async planId(input: FirstCardChargeInput): Promise<string> {
    const target = {
      entityType: 'Offer',
      entityId: `${input.offer.id}:${Math.round(input.amount * 100)}`,
    };
    const known = await this.refs.externalIdFor(
      target,
      input.acquirerCode,
      'PLAN',
    );
    if (known) return known;
    const plan = await input.gateway.createPlan(input.domToken, {
      price: input.amount,
      description: input.offer.name.slice(0, 80),
      frequency_type: input.offer.intervalType ?? 'MONTH',
      frequency: input.offer.intervalCount ?? 1,
      repetitions: 1,
    });
    try {
      await this.refs.link(input.acquirerCode, 'PLAN', plan.id, target);
      return plan.id;
    } catch (error) {
      const winner = await this.refs.externalIdFor(
        target,
        input.acquirerCode,
        'PLAN',
      );
      if (winner) return winner;
      throw error;
    }
  }
}

/**
 * Fallback source (`OFFER_CARD_TOKEN_SOURCE=card-token`): the server posts the full card to
 * the DOM customer (`/customers/{id}/card-token`), keeps only the returned token and charges
 * it standalone through the payment-link path. Same pattern the sibling atlas-hosting uses.
 */
@Injectable()
export class CardTokenEndpointSource implements CardTokenSource {
  readonly kind = 'card-token' as const;

  async chargeFirstCycle(
    input: FirstCardChargeInput,
  ): Promise<FirstCardChargeResult> {
    if (!input.gateway.createReusableCardToken)
      throw new Error('Adquirente sem tokenização de cartão reutilizável');
    // Tokenization precedes the charge: a refusal here means nothing was charged.
    const token = await input.gateway
      .createReusableCardToken(input.domToken, {
        customer: input.customer,
        card: input.card,
      })
      .catch((error: unknown) => {
        throw error instanceof Error ? markPreDispatchNoCharge(error) : error;
      });
    const paid = await input.gateway.chargePaymentLink(input.domToken, {
      domLinkId: input.domLinkId,
      amount: input.amount,
      description: input.description,
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      customerDocument: input.customer.document,
      customerPhone: input.customer.phone,
      paymentMethod: 'credit_card',
      installments: 1,
      card: { ...input.card, token },
    });
    return { paymentId: paid.id, status: paid.status, token };
  }

  /** The token was already returned by `chargeFirstCycle`; nothing to fetch later. */
  async fetchToken(): Promise<string | null> {
    return null;
  }
}

/**
 * Default source (`OFFER_CARD_TOKEN_SOURCE=customer-token`, DOM-documented path): the browser
 * tokenizes the card with the buyer's DOM `customer_id`, so the token is bound to the
 * customer wallet and reusable. The server only ever sees the token and card metadata. The
 * first charge goes through the payment-link `/transactions` path with `credit_card.upsell`
 * so the same token can be charged again by later cycles.
 */
@Injectable()
export class CustomerTokenSource implements CardTokenSource {
  readonly kind = 'customer-token' as const;

  async chargeFirstCycle(
    input: FirstCardChargeInput,
  ): Promise<FirstCardChargeResult> {
    const token = input.card.token;
    if (!token || !input.customerId)
      throw markPreDispatchNoCharge(
        new Error('Token do cartão e cliente do adquirente obrigatórios'),
      );
    const paid = await input.gateway.chargePaymentLink(input.domToken, {
      domLinkId: input.domLinkId,
      amount: input.amount,
      description: input.description,
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      customerDocument: input.customer.document,
      customerPhone: input.customer.phone,
      paymentMethod: 'credit_card',
      installments: 1,
      upsell: true,
      card: input.card,
    });
    return { paymentId: paid.id, status: paid.status, token };
  }

  /** The token is the one the browser produced; the service keeps it until the charge settles. */
  async fetchToken(): Promise<string | null> {
    return null;
  }
}
