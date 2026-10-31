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

function exact(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function money(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1e9
  );
}
export function isPreviewDraftMessage(value: unknown): value is {
  type: 'payment-link-preview:draft';
  version: 1;
  draft: PaymentLinkPreviewDraft;
} {
  if (
    !exact(value, ['type', 'version', 'draft']) ||
    value.type !== 'payment-link-preview:draft' ||
    value.version !== 1
  )
    return false;
  const d = value.draft;
  if (
    !exact(d, [
      'title',
      'description',
      'amount',
      'methods',
      'maxInstallments',
      'installments',
      'pixAmount',
      'debitAmount',
    ])
  )
    return false;
  if (
    typeof d.title !== 'string' ||
    d.title.length > 500 ||
    typeof d.description !== 'string' ||
    d.description.length > 10000
  )
    return false;
  if (!money(d.amount) || !money(d.pixAmount) || !money(d.debitAmount))
    return false;
  if (
    !exact(d.methods, ['credit', 'debit', 'pix']) ||
    !Object.values(d.methods).every((method) => typeof method === 'boolean')
  )
    return false;
  if (
    typeof d.maxInstallments !== 'number' ||
    !Number.isInteger(d.maxInstallments) ||
    d.maxInstallments < 1 ||
    d.maxInstallments > 12
  )
    return false;
  return (
    Array.isArray(d.installments) &&
    d.installments.length === d.maxInstallments &&
    Array.from(d.installments).every(
      (option, index) =>
        exact(option, ['count', 'total', 'amount', 'interest']) &&
        option.count === index + 1 &&
        money(option.total) &&
        money(option.amount) &&
        money(option.interest) &&
        Math.abs(option.amount * option.count - option.total) <=
          option.count * 0.011,
    )
  );
}
export function allowedPreviewOrigins(
  config: string | undefined,
  development: boolean,
): string[] {
  return (config ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => {
      try {
        const url = new URL(origin);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(
          url.hostname,
        );
        return (
          url.origin === origin &&
          !url.username &&
          !url.password &&
          (local
            ? development &&
              ['http:', 'https:'].includes(url.protocol) &&
              url.hostname !== '[::1]'
            : url.protocol === 'https:')
        );
      } catch {
        return false;
      }
    });
}
export function isAllowedPreviewParent(
  origin: string,
  config: string | undefined,
  development: boolean,
): boolean {
  if (allowedPreviewOrigins(config, development).includes(origin)) return true;
  if (!development) return false;
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      ['http:', 'https:'].includes(url.protocol)
    );
  } catch {
    return false;
  }
}

/** Default is the dashboard origin; explicit empty configuration denies all parents. */
export const DEFAULT_PREVIEW_PARENT_ORIGIN = 'https://simintpay.com';

export function configuredPreviewParents() {
  return allowedPreviewOrigins(
    process.env.CHECKOUT_PREVIEW_PARENT_ORIGINS ??
      DEFAULT_PREVIEW_PARENT_ORIGIN,
    process.env.NODE_ENV === 'development',
  );
}

export function previewFramePolicy(origins: string[], development: boolean) {
  const ancestors = [
    ...origins,
    ...(development
      ? [
          'http://localhost:*',
          'https://localhost:*',
          'http://127.0.0.1:*',
          'https://127.0.0.1:*',
        ]
      : []),
  ];
  return `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`;
}
