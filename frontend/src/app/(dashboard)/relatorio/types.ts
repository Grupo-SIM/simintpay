export type DateRange = {
  start: Date | null;
  end: Date | null;
};

/** Período rápido nos relatórios; `custom` usa intervalo escolhido no calendário. */
export type PeriodPreset = 'today' | '30d' | '3m' | '12m' | 'custom';

export type TransacaoDistribuicaoItem = {
  codigo: string;
  nome: string;
  quantidade: number;
  percentual: number;
};

export type TransacaoDistribuicaoResponse = {
  total: number;
  items: TransacaoDistribuicaoItem[];
};

export type ReportRow = {
  issueDate: string;
  settlementDate: string;
  customer: string;
  transactionId: string;
  type: 'Entrada' | 'Saida';
  gross: string;
  fee: string;
  reversed: string;
  net: string;
  operator: string;
  paymentLink: string;
  planName: string;
};
