export type StoredPaymentMethods = 'PIX' | 'CREDIT_CARD' | 'BOTH';

/** Normaliza o valor gravado (`PIX` | `CREDIT_CARD` | `BOTH`); ausente ou desconhecido equivale a `BOTH`. */
export function normalizeStoredPaymentMethods(
  value?: string | null,
): StoredPaymentMethods {
  return value === 'PIX' || value === 'CREDIT_CARD' ? value : 'BOTH';
}

export function acceptedMethodList(
  value?: string | null,
): Array<'CREDIT_CARD' | 'PIX'> {
  switch (normalizeStoredPaymentMethods(value)) {
    case 'PIX':
      return ['PIX'];
    case 'CREDIT_CARD':
      return ['CREDIT_CARD'];
    default:
      return ['CREDIT_CARD', 'PIX'];
  }
}

export function acceptsCard(value?: string | null): boolean {
  return normalizeStoredPaymentMethods(value) !== 'PIX';
}

export function acceptsPix(value?: string | null): boolean {
  return normalizeStoredPaymentMethods(value) !== 'CREDIT_CARD';
}
