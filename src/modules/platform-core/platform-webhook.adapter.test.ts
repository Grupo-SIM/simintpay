import { describe, test, expect } from 'bun:test';
import { platformWebhookEvent } from './platform-webhook.adapter';

describe('Provider webhook contracts', () => {
  test.each(['id', 'paymentId', 'order_id'])('DOM recognizes %s without imposing Frendz shape', field => {
    expect(platformWebhookEvent('DOM', { data: { [field]: 'payment', status: 'approved' } })).toEqual({ paymentId: 'payment', status: 'paid' });
  });
  test('Frendz prefers root status and accepts transaction hash', () => {
    expect(platformWebhookEvent('FRENDZ', { status: 'refused', transaction: { hash: 'hash', status: 'pending' } })).toEqual({ paymentId: 'hash', status: 'failed' });
  });
  test.each([null, {}, { data: { id: 'payment', status: 'mystery' } }, { data: { status: 'paid' } }])('rejects malformed or unknown event before processing', payload => {
    expect(() => platformWebhookEvent('DOM', payload)).toThrow();
  });
  test('signed provider reference can correlate immediate canonical draft', () => {
    const reference = 'a'.repeat(64);
    expect(platformWebhookEvent('DOM', { data: { id: 'remote', status: 'paid', cod_external: reference } })).toEqual({ paymentId: 'remote', status: 'paid', externalReference: reference });
    expect(platformWebhookEvent('DOM', { data: { id: 'remote', status: 'paid', cod_external: 'legacy-or-untrusted-id' } })).not.toHaveProperty('externalReference');
  });

});
