import { describe, test, expect } from 'bun:test';
import { platformWebhookEvent } from './platform-webhook.adapter';

describe('Provider webhook contracts', () => {
  test.each(['id', 'paymentId', 'order_id'])(
    'DOM recognizes %s without imposing Frendz shape',
    (field) => {
      expect(
        platformWebhookEvent('DOM', {
          data: { [field]: 'payment', status: 'approved' },
        }),
      ).toEqual({ paymentId: 'payment', status: 'paid' });
    },
  );
  test('Frendz prefers root status and accepts transaction hash', () => {
    expect(
      platformWebhookEvent('FRENDZ', {
        status: 'refused',
        transaction: { hash: 'hash', status: 'pending' },
      }),
    ).toEqual({ paymentId: 'hash', status: 'failed' });
  });
  test.each([
    null,
    {},
    { data: { id: 'payment', status: 'mystery' } },
    { data: { status: 'paid' } },
  ])('rejects malformed or unknown event before processing', (payload) => {
    expect(() => platformWebhookEvent('DOM', payload)).toThrow();
  });
  test('signed provider reference can correlate immediate canonical draft', () => {
    const reference = 'a'.repeat(64);
    expect(
      platformWebhookEvent('DOM', {
        data: { id: 'remote', status: 'paid', cod_external: reference },
      }),
    ).toEqual({
      paymentId: 'remote',
      status: 'paid',
      externalReference: reference,
    });
    expect(
      platformWebhookEvent('DOM', {
        data: {
          id: 'remote',
          status: 'paid',
          cod_external: 'legacy-or-untrusted-id',
        },
      }),
    ).not.toHaveProperty('externalReference');
    expect(
      platformWebhookEvent('DOM', {
        data: {
          id: 'remote',
          status: 'paid',
          cod_external: `pay_${reference}_2`,
        },
      }),
    ).toHaveProperty('externalReference', `pay_${reference}_2`);
    expect(
      platformWebhookEvent('FRENDZ', {
        status: 'paid',
        transaction: { hash: 'remote', cod_external: `pay_${reference}_3` },
      }),
    ).toHaveProperty('externalReference', `pay_${reference}_3`);
  });
});

for (const [raw, expected] of [
  ['paid', 'paid'],
  ['refunded', 'refunded'],
  ['chargeback', 'chargeback'],
  ['in_protest', 'in_mediation'],
  ['in_mediation', 'in_mediation'],
  ['in_dispute', 'in_mediation'],
  ['pending', 'pending'],
  ['waiting_payment', 'pending'],
  ['canceled', 'failed'],
  ['cancelled', 'failed'],
  ['refused', 'failed'],
  ['failed', 'failed'],
])
  test(`Frendz ${raw} is identical in canonical event and legacy transport`, async () => {
    const { legacyFrendzWebhookPayload } =
      await import('./platform-webhook.adapter');
    const payload = {
      status: raw,
      transaction: { id: 'payment', amount: 1234, net_amount: 1129 },
    };
    const legacy = legacyFrendzWebhookPayload(payload)!;
    expect(platformWebhookEvent('FRENDZ', payload)).toEqual({
      paymentId: legacy.data.paymentId,
      status: expected,
    });
    expect(legacy.data.status).toBe(expected);
    expect(legacy.data.amountWithoutAllFee).toBe(11.29);
  });
test('Frendz unknown root falls back to known transaction status in both ingress contracts', async () => {
  const { legacyFrendzWebhookPayload } =
    await import('./platform-webhook.adapter');
  const payload = {
    status: 'unrecognized',
    transaction: { hash: 'hash', status: 'paid', amount: '29' },
  };
  expect(platformWebhookEvent('FRENDZ', payload)).toEqual({
    paymentId: 'hash',
    status: 'paid',
  });
  expect(legacyFrendzWebhookPayload(payload)?.data).toMatchObject({
    paymentId: 'hash',
    status: 'paid',
    amountWithoutAllFee: 0.29,
  });
});
