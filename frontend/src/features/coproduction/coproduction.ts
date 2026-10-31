import type { Coproducer, CoproducerDraft, Coproduction } from './types';

export function maskPercentage(value: string): string {
  const clean = value
    .replace(/%/g, '')
    .trim()
    .replace(/\./g, ',')
    .replace(/[^\d,]/g, '');
  const [integer, ...decimals] = clean.split(',');
  return (
    integer.slice(0, 3) +
    (decimals.length ? `,${decimals.join('').slice(0, 2)}` : '')
  );
}

export function percentageBps(value: string): number {
  if (!/^\d{1,3}(?:,\d{1,2})?$/.test(value)) return NaN;
  const [integer, decimals = ''] = value.split(',');
  return Number(integer) * 100 + Number(decimals.padEnd(2, '0'));
}

export function formatPercentage(bps: number): string {
  return (bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function validateParticipants(
  rows: CoproducerDraft[],
  ownerEmail?: string,
): string | null {
  const seen = new Set<string>();
  let total = 0;
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return 'Informe um e-mail válido para cada coprodutor.';
    if (email === ownerEmail?.trim().toLowerCase())
      return 'O proprietário já recebe a participação restante.';
    if (seen.has(email))
      return 'O mesmo coprodutor não pode aparecer duas vezes.';
    seen.add(email);
    const bps = percentageBps(row.percentage);
    if (!Number.isInteger(bps) || bps <= 0 || bps > 10000)
      return 'Cada participação deve ser maior que 0% e no máximo 100%.';
    total += bps;
  }
  return total > 10000
    ? 'A soma das participações não pode ultrapassar 100%.'
    : null;
}

export function serializeParticipants(rows: CoproducerDraft[]): Coproducer[] {
  const error = validateParticipants(rows);
  if (error) throw new Error(error);
  return rows.map((row) => ({
    email: row.email.trim().toLowerCase(),
    ...(row.name ? { name: row.name } : {}),
    percentageBps: percentageBps(row.percentage),
  }));
}

/** Reject incomplete/old server responses instead of displaying an invented empty agreement. */
export function parseCoproduction(value: unknown): Coproduction {
  const data = value as Partial<Coproduction> | null;
  if (
    !data ||
    data.basis !== 'NET' ||
    !Number.isSafeInteger(data.version) ||
    Number(data.version) < 0 ||
    !Array.isArray(data.participants)
  ) {
    throw new Error(
      'O servidor retornou uma configuração de co-produção inválida.',
    );
  }
  const participants = data.participants;
  if (
    participants.some(
      (row) =>
        !row ||
        typeof row.email !== 'string' ||
        (row.name !== undefined && typeof row.name !== 'string') ||
        !Number.isInteger(row.percentageBps) ||
        row.percentageBps <= 0 ||
        row.percentageBps > 10000,
    )
  ) {
    throw new Error('O servidor retornou participações inválidas.');
  }
  const error = validateParticipants(
    participants.map((row, i) => ({
      id: String(i),
      email: row.email,
      percentage: formatPercentage(row.percentageBps),
    })),
  );
  if (error) throw new Error(error);
  if (data.mode !== undefined && !['OWN', 'INHERIT'].includes(data.mode))
    throw new Error('Modo de co-produção inválido.');
  let effective: Coproduction['effective'];
  if (data.effective != null) {
    const source = data.effective.source;
    if (
      source &&
      (typeof source.platformId !== 'string' ||
        !Number.isSafeInteger(source.version))
    )
      throw new Error('Origem de co-produção inválida.');
    effective = {
      source,
      participants: parseCoproduction({
        basis: 'NET',
        version: 0,
        participants: data.effective.participants,
      }).participants,
    };
  }
  return {
    basis: 'NET',
    version: Number(data.version),
    participants,
    ...(data.mode ? { mode: data.mode } : {}),
    ...(data.effective !== undefined ? { effective: effective ?? null } : {}),
  };
}
