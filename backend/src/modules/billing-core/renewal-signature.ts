import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET_ENV = 'RENEWAL_LINK_SECRET';
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

function secret(): string {
  const value = process.env[SECRET_ENV];
  if (!value) throw new Error(`${SECRET_ENV} is not configured`);
  return value;
}

/** HMAC-SHA256 (hex) of the contract id. Throws when `RENEWAL_LINK_SECRET` is missing. */
export function signRenewal(contractId: string): string {
  return createHmac('sha256', secret()).update(contractId).digest('hex');
}

/**
 * Timing-safe check of a renewal link signature. Fails closed: a missing secret, an empty id
 * or a malformed signature all return false.
 */
export function verifyRenewalSignature(
  contractId: string,
  sig: string,
): boolean {
  if (!contractId || typeof sig !== 'string' || !HEX_SHA256.test(sig))
    return false;
  let expected: string;
  try {
    expected = signRenewal(contractId);
  } catch {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(sig.toLowerCase(), 'hex'),
  );
}
