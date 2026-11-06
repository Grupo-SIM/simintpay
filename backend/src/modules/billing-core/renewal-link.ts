import { signRenewal } from './renewal-signature';

export const RENEWAL_LINK_BUILDER = Symbol('RENEWAL_LINK_BUILDER');

export interface RenewalLinkBuilder {
  /** Absolute URL the buyer opens to pay the next cycle of `contractId`. */
  build(input: { contractId: string; offerCode: string }): string;
}

/**
 * `${CHECKOUT_BASE_URL}/?ofertaCode=<code>&renovar=<contractId>&sig=<hmac>`. Falls back to the
 * checkout URL the rest of the backend already uses (`SIMPAY_CHECKOUT_URL`). Fails closed when
 * neither the base URL nor `RENEWAL_LINK_SECRET` is configured.
 */
export class SignedRenewalLinkBuilder implements RenewalLinkBuilder {
  build({
    contractId,
    offerCode,
  }: {
    contractId: string;
    offerCode: string;
  }): string {
    const base = (
      process.env.CHECKOUT_BASE_URL ?? process.env.SIMPAY_CHECKOUT_URL
    )?.replace(/\/+$/, '');
    if (!base) throw new Error('CHECKOUT_BASE_URL is not configured');
    const query = new URLSearchParams({
      ofertaCode: offerCode,
      renovar: contractId,
      sig: signRenewal(contractId),
    });
    return `${base}/?${query.toString()}`;
  }
}
