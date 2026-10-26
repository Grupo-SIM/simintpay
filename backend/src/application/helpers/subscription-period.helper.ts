export function advanceSubscriptionPeriod(from: Date, frequency: string): Date {
  const next = new Date(from);
  switch (frequency.toUpperCase()) {
    case 'WEEKLY':
    case 'SEMANAL':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'TRIMESTRAL':
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case 'SEMESTRAL':
      next.setUTCMonth(next.getUTCMonth() + 6);
      break;
    case 'ANUAL':
    case 'YEAR':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    default:
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  return next;
}
