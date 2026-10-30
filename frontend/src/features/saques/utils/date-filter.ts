/** YYYY-MM-DD em horário local (sem deslocar o dia por UTC). */
export function toLocalYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseQueryDate(s: string | null) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return new Date(s);
  return new Date(y, m - 1, d);
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function parseSaqueCreatedAt(
  value: string | null | undefined,
): Date | null {
  if (!value || value === '0000-00-00' || value.startsWith('0000-'))
    return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, y, m, day] = match;
    return new Date(Number(y), Number(m) - 1, Number(day));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Uma data só → filtra exatamente esse dia (não “a partir de” / “até”). */
export function normalizeDateFilterRange(
  start: Date | null,
  end: Date | null,
): { start: Date | null; end: Date | null } {
  if (!start && !end) return { start: null, end: null };
  if (start && !end) return { start, end: start };
  if (!start && end) return { start: end, end };
  return { start, end };
}

export function saqueMatchesDateRange(
  criadoEm: string | null | undefined,
  start: Date | null,
  end: Date | null,
): boolean {
  const range = normalizeDateFilterRange(start, end);
  if (!range.start && !range.end) return true;
  const created = parseSaqueCreatedAt(criadoEm);
  if (!created) return false;
  const t = created.getTime();
  if (range.start && t < startOfLocalDay(range.start).getTime()) return false;
  if (range.end && t > endOfLocalDay(range.end).getTime()) return false;
  return true;
}

export function filterSaquesByDateRange<T extends { criadoEm: string }>(
  rows: T[],
  start: Date | null,
  end: Date | null,
): T[] {
  return rows.filter((row) => saqueMatchesDateRange(row.criadoEm, start, end));
}

/** Intervalo inclusivo no dia (mesmo padrão de /transacoes). */
export function dateToApiStartIso(ymd: string | undefined) {
  if (!ymd) return undefined;
  return `${ymd.slice(0, 10)}T00:00:00.000Z`;
}

export function dateToApiEndIso(ymd: string | undefined) {
  if (!ymd) return undefined;
  return `${ymd.slice(0, 10)}T23:59:59.999Z`;
}

/** Admin: "YYYY-MM-DD,YYYY-MM-DD" */
export function buildAdminDateRangeParam(
  start: Date | null,
  end: Date | null,
): string | undefined {
  const { start: sDate, end: eDate } = normalizeDateFilterRange(start, end);
  if (!sDate || !eDate) return undefined;
  return `${toLocalYmd(sDate)},${toLocalYmd(eDate)}`;
}

/** YMD da URL: se só dataInicio ou só dataFim, replica no outro campo. */
export function resolveYmdDateFilter(dataInicio?: string, dataFim?: string) {
  const inicio = dataInicio?.slice(0, 10);
  const fim = dataFim?.slice(0, 10);
  if (!inicio && !fim) return { dataInicio: undefined, dataFim: undefined };
  const day = inicio ?? fim!;
  return { dataInicio: inicio ?? day, dataFim: fim ?? day };
}

export function parseDateRangeFromYmd(dataInicio?: string, dataFim?: string) {
  const { dataInicio: ini, dataFim: fim } = resolveYmdDateFilter(
    dataInicio,
    dataFim,
  );
  return {
    start: parseQueryDate(ini ?? null),
    end: parseQueryDate(fim ?? null),
  };
}

export function withSaqueApiDateQuery<
  T extends { dataInicio?: string; dataFim?: string },
>(query: T) {
  return {
    ...query,
    dataInicio: dateToApiStartIso(query.dataInicio),
    dataFim: dateToApiEndIso(query.dataFim),
  };
}
