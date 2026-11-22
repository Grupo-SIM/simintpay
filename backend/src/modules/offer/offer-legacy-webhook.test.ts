import { describe, expect, test } from 'bun:test';
import {
  purchaseWebhookBody,
  subscriptionExpiredWebhookBody,
  subscriptionWebhookBody,
} from './offer-legacy-webhook';

const offer = {
  id: 'offer-1',
  name: 'Plano Mensal',
  intervalType: 'MONTH' as const,
  intervalCount: 1,
};
const charge = {
  customerEmail: 'ana@test.dev',
  customerName: 'Ana',
  customerDocument: '123.456.789-09',
};
const tx = {
  id: 'tx-1',
  amount: 39.9,
  netAmount: 36.456,
  paymentMethod: 'CREDIT_CARD',
  customerEmail: 'ana@test.dev',
  customerName: 'Ana',
  customerDocument: '123.456.789-09',
  customerPhone: '11999999999',
};

// Corpos montados a partir de `git show 0f9bcc6e` (notifyPaymentLinkExternalWebhook,
// checkout-subscription-link-card, subscription-webhook.service renovação e handleCancelled).
describe('legacy link webhook bodies', () => {
  test('purchase_approved / purchase_refunded match notifyPaymentLinkExternalWebhook', () => {
    const items = [
      { tipo: 'PRINCIPAL' as const, titulo: 'Curso', valor: 39.9 },
    ];
    for (const event of ['purchase_approved', 'purchase_refunded'] as const) {
      expect(
        purchaseWebhookBody({
          event,
          offer,
          charge,
          tx,
          planName: 'Curso',
          items,
        }),
      ).toEqual({
        event,
        customerEmail: 'ana@test.dev',
        customerName: 'Ana',
        planName: 'Curso',
        items,
        paymentMethod: 'CREDIT_CARD',
        amountCharged: 39.9,
        netAmount: 36.46,
        orderId: 'tx-1',
        linkId: 'offer-1',
        cpf: '12345678909',
        phone: '11999999999',
      });
    }
  });

  test('net falls back to the gross amount and a CNPJ goes under cnpj', () => {
    const body = purchaseWebhookBody({
      event: 'purchase_approved',
      offer,
      charge,
      tx: { ...tx, netAmount: null, customerDocument: '12.345.678/0001-95' },
      planName: 'Curso',
      items: [],
    });
    expect(body.netAmount).toBe(39.9);
    expect(body).toMatchObject({ cnpj: '12345678000195' });
    expect(body).not.toHaveProperty('cpf');
  });

  test('subscription_activated and subscription_renewed match the subscription link bodies', () => {
    for (const event of [
      'subscription_activated',
      'subscription_renewed',
    ] as const) {
      expect(subscriptionWebhookBody({ event, offer, charge, tx })).toEqual({
        event,
        customerEmail: 'ana@test.dev',
        customerName: 'Ana',
        planName: 'Plano Mensal',
        paymentMethod: 'CREDIT_CARD',
        frequencyType: 'MONTHLY',
        amountCharged: 39.9,
        netAmount: 36.46,
        orderId: 'tx-1',
        linkId: 'offer-1',
        cpf: '12345678909',
        phone: '11999999999',
      });
    }
  });

  test('subscription_expired carries zero amounts and the contract id, without document', () => {
    expect(
      subscriptionExpiredWebhookBody({
        offer: { ...offer, intervalType: 'YEAR' },
        contract: {
          id: 'ctr-1',
          customerEmail: 'ana@test.dev',
          customerName: 'Ana',
        },
      }),
    ).toEqual({
      event: 'subscription_expired',
      customerEmail: 'ana@test.dev',
      customerName: 'Ana',
      planName: 'Plano Mensal',
      paymentMethod: 'CREDIT_CARD',
      frequencyType: 'ANUAL',
      amountCharged: 0,
      netAmount: 0,
      orderId: 'ctr-1',
      linkId: 'offer-1',
    });
  });
});
