export type ExtratoNatureza =
  | 'SALE'
  | 'COMMISSION'
  | 'COPRODUCTION'
  | 'AFFILIATE'
  | 'WITHDRAWAL'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'TRANSFER';

export type ExtratoEntry = {
  id: string;
  action: string;
  natureza: ExtratoNatureza | null;
  descricao: string | null;
  transacaoId: string | null;
  /** Variação do saldo disponível (negativa = saída). */
  valor: number;
  /** Variação do saldo em processamento. */
  valorBloqueado: number;
  criadoEm: string;
};

export type ExtratoResponse = {
  data: ExtratoEntry[];
  page: number;
  pageSize: number;
  total: number;
  resumo: { entradas: number; saidas: number };
};

export type ListExtratoQuery = {
  page?: number;
  pageSize?: number;
  dataInicio?: string;
  dataFim?: string;
  tipo?: 'ENTRADA' | 'SAIDA';
  natureza?: ExtratoNatureza;
  busca?: string;
};
