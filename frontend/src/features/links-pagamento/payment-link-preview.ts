/** Version 1 intentionally excludes identity, authentication, files and payment callbacks. */
export type PaymentLinkPreviewDraft = {
  title: string;
  description: string;
  amount: number;
  methods: { credit: boolean; debit: boolean; pix: boolean };
  maxInstallments: number;
  installments: {
    count: number;
    total: number;
    amount: number;
    interest: number;
  }[];
  pixAmount: number;
  debitAmount: number;
};

export function checkoutPreviewUrl(baseUrl: string, parentOrigin: string) {
  const url = new URL('/preview/payment-link', baseUrl);
  if (url.username || url.password)
    throw new Error('Origem de checkout inválida.');
  if (
    url.protocol !== 'https:' &&
    !(
      process.env.NODE_ENV === 'development' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  ) {
    throw new Error('Origem de checkout inválida.');
  }
  url.searchParams.set('parentOrigin', parentOrigin);
  return url;
}

export function isPreviewSignal(
  data: unknown,
  type: 'ready' | 'loaded' | 'close',
) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const signal = data as Record<string, unknown>;
  return (
    Object.keys(signal).length === 2 &&
    signal.version === 1 &&
    signal.type === `payment-link-preview:${type}`
  );
}

/** Pedido de preço do checkout (iframe): códigos dos order bumps marcados. */
export function parsePricingRequest(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;
  if (
    Object.keys(m).length !== 4 ||
    m.version !== 1 ||
    m.type !== 'payment-link-preview:pricing' ||
    !Number.isSafeInteger(m.requestId) ||
    !Array.isArray(m.bumpCodes) ||
    m.bumpCodes.length > 20 ||
    !m.bumpCodes.every((c) => typeof c === 'string' && c.length <= 100)
  )
    return null;
  return {
    requestId: m.requestId as number,
    bumpCodes: m.bumpCodes as string[],
  };
}
