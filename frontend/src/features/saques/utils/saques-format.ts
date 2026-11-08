export function formatBRL(value: number | undefined | null) {
  const v = Number(value ?? 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(value: string | undefined | null) {
  if (!value || value === '0000-00-00' || value === '0000-00-00 00:00:00')
    return '-';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    if (year === '0000') return '-';
    return `${day}/${month}/${year}`;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR');
}

export function mapStatusLabel(status: string) {
  const s = (status ?? '').toUpperCase();
  if (s === 'PAGO' || s === 'COMPLETED') return 'Pago';
  if (s === 'APROVADO' || s === 'APROVADA' || s === 'APPROVED')
    return 'Aprovado';
  if (s === 'PENDENTE' || s === 'PENDING') return 'Pendente';
  if (
    s === 'REJEITADO' ||
    s === 'REJECTED' ||
    s === 'RECUSADO' ||
    s === 'RECUSADA'
  )
    return 'Recusado';
  return status ?? '-';
}

export function mapStatusBadgeValue(status: string) {
  const s = (status ?? '').toUpperCase();
  if (
    s === 'PAGO' ||
    s === 'APROVADO' ||
    s === 'APROVADA' ||
    s === 'APPROVED' ||
    s === 'COMPLETED'
  )
    return 'APPROVED';
  if (s === 'PENDENTE' || s === 'PENDING') return 'PENDING';
  if (
    s === 'REJEITADO' ||
    s === 'REJECTED' ||
    s === 'RECUSADO' ||
    s === 'RECUSADA'
  )
    return 'REJECTED';
  return 'DEFAULT';
}

/** Só pendente pode ser confirmado/negado pelo admin; já aprovado ou pago não. */
export function isSaqueAguardandoAcaoAdmin(status: string) {
  const s = (status ?? '').toUpperCase();
  return s === 'PENDENTE' || s === 'PENDING';
}

export const TABLE_PAGE_SIZE = 20;
/** Busca mais itens quando há filtro de data para filtrar no cliente se a API ignorar o parâmetro. */
export const DATE_FILTER_FETCH_SIZE = 500;
