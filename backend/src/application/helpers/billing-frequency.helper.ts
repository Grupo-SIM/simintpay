/** Dias de acesso por ciclo conforme a frequência do plano/link (default mensal = 30). */
export function accessDaysForFrequency(freq?: string | null): number {
  switch (
    String(freq ?? '')
      .toUpperCase()
      .trim()
  ) {
    case 'ANUAL':
    case 'ANNUAL':
    case 'YEAR':
      return 365;
    case 'SEMESTRAL':
    case 'SEMESTER':
      return 180;
    case 'TRIMESTRAL':
    case 'QUARTER':
      return 90;
    case 'SEMANAL':
    case 'WEEKLY':
    case 'WEEK':
      return 7;
    case 'DAILY':
    case 'DAY':
      return 1;
    default:
      return 30; // MONTHLY / MONTH / MENSAL
  }
}

const INTERVAL_DAYS: Record<string, number> = {
  DAY: 1,
  WEEK: 7,
  MONTH: 30,
  YEAR: 365,
};

/** Dias de acesso por ciclo de uma oferta, derivados da renovação; null para compra única. */
export function accessDaysForOffer(offer: {
  renewalMode: string;
  intervalType?: string | null;
  intervalCount?: number | null;
}): number | null {
  if (offer.renewalMode === 'NONE' || !offer.intervalType) return null;
  const unit = INTERVAL_DAYS[offer.intervalType];
  return unit ? unit * (offer.intervalCount ?? 1) : null;
}
