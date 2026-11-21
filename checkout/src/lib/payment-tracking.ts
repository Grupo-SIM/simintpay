/** Attribution forwarded to SimIntPay; never forwards identity or financial fields. */
export function checkoutTracking(
  search: string,
  cookie = '',
): Record<string, string> {
  const query = new URLSearchParams(search);
  const allowed = [
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
  const tracking: Record<string, string> = {};
  for (const key of allowed) {
    const value = query.get(key);
    if (value && value.length <= 500) tracking[key] = value;
  }
  // `ref` is an alias; always forwarded as `aff` and never as a financial field.
  const affiliate = query.get('aff') ?? query.get('ref');
  if (
    affiliate &&
    affiliate.length <= 500 &&
    /^[A-Za-z0-9_-]{3,40}$/.test(affiliate)
  )
    tracking.aff = affiliate;
  for (const key of ['fbc', 'fbp']) {
    if (tracking[key]) continue;
    const value = cookie
      .split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`_${key}=`))
      ?.slice(key.length + 2);
    if (value && value.length <= 500) {
      try {
        tracking[key] = decodeURIComponent(value);
      } catch {
        /* malformed cookie */
      }
    }
  }
  return tracking;
}

/** Tracking of the current page; call only from the browser (event handlers). */
export function browserCheckoutTracking(): Record<string, string> {
  return checkoutTracking(window.location.search, window.document.cookie);
}
