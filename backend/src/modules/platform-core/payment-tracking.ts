const KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'src',
  'fbclid',
  'fbc',
  'fbp',
];
/** Public affiliate code: server generated, short and never an e-mail. */
export const AFFILIATE_CODE_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;
/** Client attribution is untrusted metadata; never interpreted as financial input. */
export function paymentTracking(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const entries = Object.entries(input).filter(
    ([key, item]) =>
      KEYS.includes(key) && typeof item === 'string' && item.length <= 500,
  );
  const tracking = Object.fromEntries(entries) as Record<string, string>;
  // `ref` is an alias of `aff`; `aff` wins. An invalid code is silently dropped.
  for (const key of ['aff', 'ref']) {
    const code = input[key];
    if (typeof code === 'string' && AFFILIATE_CODE_PATTERN.test(code)) {
      tracking.aff = code;
      break;
    }
  }
  return tracking;
}
