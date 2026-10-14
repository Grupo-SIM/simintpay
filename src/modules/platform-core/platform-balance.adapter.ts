/** Product ledger rules; wallet custody stays user-scoped in the finance core. */
export function platformBalanceRules(tag: string) {
  const key = tag.toLowerCase();
  return { basis: 'persisted-net' as const, withdrawalPlatforms: tag === 'BOSQUE' ? [key, `${key}-baseline`] : [key] };
}
