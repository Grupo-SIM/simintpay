export type SaqueStatus = 'PENDENTE' | 'APROVADO' | 'REJEITADO' | 'PAGO';

export type Saque = {
  id: string;
  valor: number;
  status: SaqueStatus;
  criadoEm: string;
};

export type ListSaquesQuery = {
  page?: number;
  pageSize?: number;
  status?: SaqueStatus;
};

export type CreateSaqueDto = {
  valor: number;
  chavePix?: string;
};
