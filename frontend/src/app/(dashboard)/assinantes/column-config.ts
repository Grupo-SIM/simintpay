/** Colunas do dropdown "Dados" (padrão relatório/planos). */
export const SUBSCRIBER_TABLE_COLUMNS = [
  'Nome',
  'Plataforma',
  'Descrição',
  'Intervalo',
  'Valor',
  'Ativo',
  'Primeira cobrança',
  'Próxima cobrança',
] as const;

export function getDefaultSubscriberColumnVisibility(): Record<
  string,
  boolean
> {
  return Object.fromEntries(SUBSCRIBER_TABLE_COLUMNS.map((c) => [c, true]));
}
