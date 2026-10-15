const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'fbclid', 'fbc', 'fbp'];
/** Client attribution is untrusted metadata; never interpreted as financial input. */
export function paymentTracking(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(([key, item]) => KEYS.includes(key) && typeof item === 'string' && item.length <= 500);
  return Object.fromEntries(entries) as Record<string, string>;
}
