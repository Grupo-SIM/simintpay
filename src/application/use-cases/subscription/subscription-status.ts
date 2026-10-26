/** Known provider states only. Missing/new states never authorize history removal. */
export function subscriptionStatusGroup(status: unknown, paused = false): 'active' | 'paused' | 'deactivated' | 'unknown' {
  const value = String(status ?? '').trim().toLowerCase();
  if (paused || value === 'paused') return 'paused';
  if (['active', 'actived', 'activated', 'true', '1'].includes(value)) return 'active';
  if (['cancelled', 'canceled', 'inactive', 'disabled', 'deactivated'].includes(value)) return 'deactivated';
  return 'unknown';
}
