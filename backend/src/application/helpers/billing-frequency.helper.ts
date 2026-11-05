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
