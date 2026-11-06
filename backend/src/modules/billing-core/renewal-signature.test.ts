import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { signRenewal, verifyRenewalSignature } from './renewal-signature';

describe('renewal signature', () => {
  const original = process.env.RENEWAL_LINK_SECRET;
  beforeEach(() => {
    process.env.RENEWAL_LINK_SECRET = 'test-secret';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.RENEWAL_LINK_SECRET;
    else process.env.RENEWAL_LINK_SECRET = original;
  });

  it('signs deterministically as 64 hex chars and verifies', () => {
    const sig = signRenewal('contract-1');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(signRenewal('contract-1')).toBe(sig);
    expect(verifyRenewalSignature('contract-1', sig)).toBe(true);
  });

  it('rejects another contract, a tampered or malformed signature', () => {
    const sig = signRenewal('contract-1');
    expect(verifyRenewalSignature('contract-2', sig)).toBe(false);
    const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    expect(verifyRenewalSignature('contract-1', flipped)).toBe(false);
    expect(verifyRenewalSignature('contract-1', sig.slice(2))).toBe(false);
    expect(verifyRenewalSignature('contract-1', 'zz'.repeat(32))).toBe(false);
    expect(verifyRenewalSignature('contract-1', '')).toBe(false);
    expect(verifyRenewalSignature('', sig)).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    const sig = signRenewal('contract-1');
    process.env.RENEWAL_LINK_SECRET = 'other-secret';
    expect(verifyRenewalSignature('contract-1', sig)).toBe(false);
  });

  it('fails closed without the secret', () => {
    const sig = signRenewal('contract-1');
    delete process.env.RENEWAL_LINK_SECRET;
    expect(() => signRenewal('contract-1')).toThrow();
    expect(verifyRenewalSignature('contract-1', sig)).toBe(false);
  });
});
