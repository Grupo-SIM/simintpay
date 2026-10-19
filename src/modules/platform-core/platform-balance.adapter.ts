/** Product ledger rules; wallet custody stays user-scoped in the finance core. */
export function platformBalanceRules(tag: string) {
  const key = tag.toLowerCase();
  const aliases = [...new Set([key, key.replaceAll('-', '_'), ...(tag === 'EBOOK' ? ['ebooksim'] : []), ...(tag === 'BOSQUE' ? [`${key}-baseline`] : [])])];
  return { basis: 'persisted-net' as const, withdrawalPlatforms: aliases };
}
