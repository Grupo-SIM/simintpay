type Interval = { type: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'; count: number };

/** Calendar interval of a legacy `PlanType` (or similar) value; unknown defaults to monthly. */
export function intervalForFrequency(freq?: string | null): Interval {
  switch (
    String(freq ?? '')
      .toUpperCase()
      .trim()
  ) {
    case 'ANUAL':
    case 'ANNUAL':
    case 'YEAR':
      return { type: 'YEAR', count: 1 };
    case 'SEMESTRAL':
    case 'SEMESTER':
      return { type: 'MONTH', count: 6 };
    case 'TRIMESTRAL':
    case 'QUARTER':
      return { type: 'MONTH', count: 3 };
    case 'WEEKLY':
    case 'SEMANAL':
    case 'WEEK':
      return { type: 'WEEK', count: 1 };
    case 'DAILY':
    case 'DAY':
      return { type: 'DAY', count: 1 };
    default:
      return { type: 'MONTH', count: 1 };
  }
}
