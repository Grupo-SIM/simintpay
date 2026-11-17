export type DateRange = {
  start: Date | null;
  end: Date | null;
};

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
