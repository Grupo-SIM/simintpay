import type { ExtratoEntry, ExtratoNatureza } from '../types/extrato.types';

export const EXTRATO_PAGE_SIZE = 20;

const NATUREZA_LABEL: Record<ExtratoNatureza, string> = {
  SALE: 'Venda',
  COMMISSION: 'Comissão',
  COPRODUCTION: 'Coprodução',
  AFFILIATE: 'Afiliado',
  WITHDRAWAL: 'Saque',
  REFUND: 'Estorno',
  ADJUSTMENT: 'Ajuste',
  TRANSFER: 'Transferência',
};

export const NATUREZA_OPTIONS = (
  Object.entries(NATUREZA_LABEL) as [ExtratoNatureza, string][]
).map(([value, label]) => ({ value, label }));

export function naturezaLabel(natureza: ExtratoNatureza | null) {
  return natureza ? NATUREZA_LABEL[natureza] : 'Outros';
}

export function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });
}

/** Texto exibido: descrição do lançamento ou, na falta dela, a natureza. */
export function entryTitle(entry: ExtratoEntry) {
  return entry.descricao?.trim() || naturezaLabel(entry.natureza);
}
