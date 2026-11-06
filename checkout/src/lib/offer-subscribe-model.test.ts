import { describe, expect, test } from 'bun:test';
import type { PublicOffer } from './offer-checkout-model';
import {
  cardCustomerBody,
  cardLast4,
  consentText,
  frequencyLabel,
  intervalPhrase,
  mapSubscribeError,
  mapSubscribeResponse,
  parseCardExpiry,
  renewalNotice,
  subscribeBody,
  subscribeMethod,
  trialNotice,
  type SubscribeResponse,
} from './offer-subscribe-model';

const offer: PublicOffer = {
  code: 'OF-2',
  name: 'Clube',
  description: null,
  amountCents: 4990,
  acceptedMethods: ['CREDIT_CARD', 'PIX'],
  maxInstallments: 1,
  renewalMode: 'AUTO_CHARGE',
  intervalType: 'MONTH',
  intervalCount: 1,
  trialDays: 0,
};
const customer = {
  name: 'Ana',
  email: 'a@b.co',
  document: '12345678901',
  phone: '11999999999',
};
const now = new Date(2026, 10, 5, 12);

describe('offer subscribe model', () => {
  test('escolhe o meio pelo modo de renovação', () => {
    expect(subscribeMethod(offer)).toBe('credit_card');
    expect(subscribeMethod({ ...offer, renewalMode: 'MANUAL_PAY' })).toBe(
      'pix',
    );
    expect(subscribeMethod({ ...offer, acceptedMethods: ['PIX'] })).toBeNull();
    expect(subscribeMethod({ ...offer, renewalMode: 'NONE' })).toBeNull();
  });

  test('textos de intervalo', () => {
    expect(intervalPhrase(offer)).toBe('a cada mês');
    expect(intervalPhrase({ ...offer, intervalCount: 3 })).toBe(
      'a cada 3 meses',
    );
    expect(intervalPhrase({ ...offer, intervalType: 'YEAR' })).toBe(
      'a cada ano',
    );
    expect(
      intervalPhrase({ ...offer, intervalType: 'YEAR', intervalCount: 2 }),
    ).toBe('a cada 2 anos');
    expect(frequencyLabel(offer)).toBe('Mensal');
    expect(frequencyLabel({ ...offer, intervalCount: 3 })).toBe(
      'Recorrente, a cada 3 meses',
    );
  });

  test('avisos de renovação, consentimento e trial', () => {
    expect(renewalNotice(offer, 'R$ 49,90')).toContain(
      'cobrado automaticamente no cartão',
    );
    expect(
      renewalNotice({ ...offer, renewalMode: 'MANUAL_PAY' }, 'R$ 49,90'),
    ).toContain('pagará o PIX a cada ciclo');
    expect(consentText(offer, 'R$ 49,90')).toContain('a cada mês');
    expect(trialNotice(offer, now)).toBeNull();
    const text = trialNotice({ ...offer, trialDays: 7 }, now)!;
    expect(text).toContain('7 dias');
    expect(text).toContain('Nenhuma cobrança hoje');
    expect(text).toContain('12/11/2026');
  });

  test('last4 e validade', () => {
    expect(cardLast4('4111 1111 1111 1234')).toBe('1234');
    expect(parseCardExpiry('3', '30', now)).toEqual({
      month: '03',
      year: '2030',
      expired: false,
    });
    expect(parseCardExpiry('10', '26', now)?.expired).toBe(true);
    expect(parseCardExpiry('11', '26', now)?.expired).toBe(false);
    expect(parseCardExpiry('13', '30', now)).toBeNull();
  });

  test('corpo do card-customer', () => {
    expect(cardCustomerBody({ ...customer, phone: '' })).toEqual({
      customerName: 'Ana',
      customerEmail: 'a@b.co',
      customerDocument: '12345678901',
    });
  });

  test('subscribe com cartão envia só token e metadados', () => {
    const body = subscribeBody({
      method: 'credit_card',
      customer,
      tracking: { utm_source: 'x' },
      card: {
        tokenized: { token: 'tok', brand: 'visa', bin: '411111******1234' },
        customerId: 'cus_1',
        last4: '1234',
        expMonth: '03',
        expYear: '2030',
        holderName: 'ANA',
      },
    });
    expect(body.card).toEqual({
      token: 'tok',
      customerId: 'cus_1',
      last4: '1234',
      exp_month: '03',
      exp_year: '2030',
      holder_name: 'ANA',
      brand: 'visa',
      bin: '411111******1234',
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('cvv');
    expect(raw).not.toContain('holder_document');
    expect(raw).not.toContain('"number"');
    expect(body.documentType).toBe('CPF');
  });

  test('subscribe PIX não leva cartão', () => {
    const body = subscribeBody({ method: 'pix', customer });
    expect('card' in body).toBe(false);
    expect(body.paymentMethod).toBe('pix');
  });

  const response: SubscribeResponse = {
    contractId: 'c1',
    chargeId: 'ch1',
    transactionId: 'tx1',
    existing: false,
    contractStatus: 'ACTIVE',
    chargeStatus: 'PAID',
    renewalMode: 'AUTO_CHARGE',
    amount: 49.9,
    nextChargeAt: '2026-12-05T00:00:00.000Z',
    cardSaved: true,
    pix: null,
    redirectUrl: 'https://x.test',
  };

  test('mapeia respostas', () => {
    expect(mapSubscribeResponse(response)).toMatchObject({
      kind: 'paid',
      amount: 49.9,
    });
    expect(
      mapSubscribeResponse({
        ...response,
        chargeStatus: 'TRIAL',
        chargeId: null,
        transactionId: null,
      }),
    ).toMatchObject({ kind: 'trial' });
    expect(
      mapSubscribeResponse({
        ...response,
        chargeStatus: 'PENDING',
        pix: { pixContent: 'abc', qrCode: null, pixExpire: null },
      }),
    ).toMatchObject({ kind: 'pix', transactionId: 'tx1', pixContent: 'abc' });
    expect(mapSubscribeResponse({ ...response, existing: true })).toMatchObject(
      { kind: 'paid', existing: true },
    );
  });

  test('mapeia erros', () => {
    expect(
      mapSubscribeError(400, { message: 'Pagamento recusado' }),
    ).toMatchObject({ retryable: true });
    expect(mapSubscribeError(404).retryable).toBe(false);
    expect(mapSubscribeError(409).message).toContain('suporte');
    expect(mapSubscribeError(500).retryable).toBe(true);
  });
});
