export function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(w => matches(row, w));
    if (key === 'OR') return value.some((w: any) => matches(row, w));
    if (key === 'NOT') return !matches(row, value);
    const field = row[key];
    if (value === null || typeof value !== 'object' || value instanceof Date) return field === value;
    if ('in' in value && !value.in.includes(field)) return false;
    if ('not' in value && field === value.not) return false;
    if ('contains' in value && !(value.mode === 'insensitive' ? String(field).toLowerCase().includes(String(value.contains).toLowerCase()) : String(field).includes(value.contains))) return false;
    if ('gte' in value && field < value.gte || 'lte' in value && field > value.lte) return false;
    return true;
  });
}
