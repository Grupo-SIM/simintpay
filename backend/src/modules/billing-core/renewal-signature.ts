import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET_ENV = 'RENEWAL_LINK_SECRET';
/** Segredo anterior, aceito só na verificação, para trocar a chave sem invalidar links já enviados. */
const PREVIOUS_SECRET_ENV = 'RENEWAL_LINK_SECRET_PREVIOUS';
const HEX_SHA256 = /^[0-9a-f]{64}$/i;
/** 32 bytes em hex têm 64 caracteres; em base64, 44. Abaixo disso o segredo é fraco demais. */
export const MIN_SECRET_LENGTH = 32;

function readSecret(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} must have at least ${MIN_SECRET_LENGTH} characters (use 32 random bytes)`,
    );
  }
  return value;
}

function secret(): string {
  const value = readSecret(SECRET_ENV);
  if (!value) throw new Error(`${SECRET_ENV} is not configured`);
  return value;
}

function hmac(key: string, contractId: string): Buffer {
  return createHmac('sha256', key).update(contractId).digest();
}

/** HMAC-SHA256 (hex) of the contract id. Throws when the secret is missing or too short. */
export function signRenewal(contractId: string): string {
  return hmac(secret(), contractId).toString('hex');
}

/**
 * Timing-safe check of a renewal link signature. Fails closed: a missing or weak secret,
 * an empty id or a malformed signature all return false. During a rotation the previous
 * secret also validates links that were already sent, but new links are always signed
 * with the current one.
 */
export function verifyRenewalSignature(
  contractId: string,
  sig: string,
): boolean {
  if (!contractId || typeof sig !== 'string' || !HEX_SHA256.test(sig))
    return false;
  const given = Buffer.from(sig.toLowerCase(), 'hex');
  let current: string;
  try {
    current = secret();
  } catch {
    return false;
  }
  if (timingSafeEqual(hmac(current, contractId), given)) return true;
  let previous: string | undefined;
  try {
    previous = readSecret(PREVIOUS_SECRET_ENV);
  } catch {
    return false;
  }
  return previous ? timingSafeEqual(hmac(previous, contractId), given) : false;
}
