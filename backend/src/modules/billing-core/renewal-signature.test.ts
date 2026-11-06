import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  MIN_SECRET_LENGTH,
  signRenewal,
  verifyRenewalSignature,
} from './renewal-signature';

const CURRENT = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('renewal signature', () => {
  const original = {
    current: process.env.RENEWAL_LINK_SECRET,
    previous: process.env.RENEWAL_LINK_SECRET_PREVIOUS,
  };
  beforeEach(() => {
    process.env.RENEWAL_LINK_SECRET = CURRENT;
    delete process.env.RENEWAL_LINK_SECRET_PREVIOUS;
  });
  afterEach(() => {
    if (original.current === undefined) delete process.env.RENEWAL_LINK_SECRET;
    else process.env.RENEWAL_LINK_SECRET = original.current;
    if (original.previous === undefined)
      delete process.env.RENEWAL_LINK_SECRET_PREVIOUS;
    else process.env.RENEWAL_LINK_SECRET_PREVIOUS = original.previous;
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
    process.env.RENEWAL_LINK_SECRET = OTHER;
    expect(verifyRenewalSignature('contract-1', sig)).toBe(false);
  });

  it('fails closed without the secret', () => {
    const sig = signRenewal('contract-1');
    delete process.env.RENEWAL_LINK_SECRET;
    expect(() => signRenewal('contract-1')).toThrow();
    expect(verifyRenewalSignature('contract-1', sig)).toBe(false);
  });

  it('refuses a secret shorter than the minimum', () => {
    process.env.RENEWAL_LINK_SECRET = 'x'.repeat(MIN_SECRET_LENGTH - 1);
    expect(() => signRenewal('contract-1')).toThrow(/at least/);
    expect(verifyRenewalSignature('contract-1', '0'.repeat(64))).toBe(false);
    process.env.RENEWAL_LINK_SECRET = 'x'.repeat(MIN_SECRET_LENGTH);
    expect(
      verifyRenewalSignature('contract-1', signRenewal('contract-1')),
    ).toBe(true);
  });

  it('accepts links signed with the previous secret during a rotation', () => {
    const oldSig = signRenewal('contract-1');
    process.env.RENEWAL_LINK_SECRET = OTHER;
    expect(verifyRenewalSignature('contract-1', oldSig)).toBe(false);
    process.env.RENEWAL_LINK_SECRET_PREVIOUS = CURRENT;
    expect(verifyRenewalSignature('contract-1', oldSig)).toBe(true);
    // novos links usam sempre a chave atual
    expect(signRenewal('contract-1')).not.toBe(oldSig);
    expect(verifyRenewalSignature('contract-2', oldSig)).toBe(false);
  });

  it('ignores a weak previous secret instead of accepting it', () => {
    process.env.RENEWAL_LINK_SECRET_PREVIOUS = 'weak';
    const sig = signRenewal('contract-1');
    expect(verifyRenewalSignature('contract-1', sig)).toBe(true);
    process.env.RENEWAL_LINK_SECRET = OTHER;
    expect(verifyRenewalSignature('contract-1', sig)).toBe(false);
  });
});
