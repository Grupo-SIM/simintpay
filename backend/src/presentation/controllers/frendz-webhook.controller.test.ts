import { describe, expect, mock, test } from 'bun:test';
import { FrendzWebhookController } from './frendz-webhook.controller';

// Exercise contract transformation without legacy credential lookup or network.
function transform(id: string, status: string) {
  const controller = new FrendzWebhookController({ publish: mock(async () => {}) } as never);
  return (controller as any).toCanonicalPayload({ token: 'shared-credential', event: 'transaction', status,
    transaction: { id, amount: 1234, net_amount: 1100 } });
}

describe('Legacy Frendz webhook event identity', () => {
  test('shared credential does not collapse different payments or refunds', () => {
    const paid = transform('first', 'paid');
    expect(paid.signature).not.toBe(transform('second', 'paid').signature);
    expect(paid.signature).not.toBe(transform('first', 'refunded').signature);
    expect(paid.signature).toBe(transform('first', 'paid').signature);
  });
  test('preserves cents conversion and excludes credentials from queue payload', () => {
    const canonical = transform('first', 'paid');
    expect(canonical.data).toMatchObject({ paymentId: 'first', status: 'paid', amountWithoutAllFee: 11, acquirer: 'FRENDZ' });
    expect(JSON.stringify(canonical)).not.toContain('shared-credential');
    expect(canonical).not.toHaveProperty('token');
  });
});
