/** Data de hoje (YYYY-MM-DD) no fuso America/Sao_Paulo. */
export function todayYmdSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Formata YYYY-MM-DD como DD/MM/YYYY sem passar por Date (sem deslocamento de fuso). */
export function formatYmd(ymd: string | null | undefined): string {
  const m = ymd?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '-';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatCents(cents: number | null | undefined): string {
  return (Number(cents ?? 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
