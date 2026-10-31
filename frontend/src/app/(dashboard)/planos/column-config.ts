/** Colunas do dropdown "Dados" (mesmo padrão do relatório). */
export const PLAN_TABLE_COLUMNS = [
  'Id',
  'Nome do plano',
  'Plataforma',
  'Link de pagamento',
  'Intervalo',
  'Forma de pagamento',
  'Status',
  'Assinaturas',
  'Data de criação',
  'Criado por',
  'CPF Dono',
] as const;

export type PlanTableColumn = (typeof PLAN_TABLE_COLUMNS)[number];

/** Estado inicial conforme layout. */
export function getDefaultPlanColumnVisibility(): Record<string, boolean> {
  return {
    Id: false,
    'Nome do plano': true,
    Plataforma: true,
    'Link de pagamento': true,
    Intervalo: true,
    'Forma de pagamento': false,
    Status: true,
    Assinaturas: false,
    'Data de criação': true,
    'Criado por': true,
    'CPF Dono': true,
  };
}
