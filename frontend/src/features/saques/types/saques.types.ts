export type SaqueStatus =
  | 'PENDENTE'
  | 'APROVADO'
  | 'REJEITADO'
  | 'PAGO'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'APROVADA'
  | 'RECUSADA';

export type Saque = {
  id: string;
  valor: number;
  valorLiquido?: number;
  /** Saldo histórico após este saque; nunca derivado do saldo atual. */
  saldoRestanteAposSaque?: number | null;
  status: SaqueStatus;
  via: string | null;
  chavePix: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  comprovante: string | null;
  receiptImage: string | null;
  comprovanteVisivel?: boolean;
  rejectionReason: string | null;
  observacao: string | null;
  valorBruto?: number;
  taxa?: number;
  taxas?: { total: number };
  criadoEm: string;
  dataTransferencia: string | null;
  usuario?: {
    id: string;
    nome: string;
    email: string;
    modulo: {
      nome: string;
      slug: string;
    } | null;
    saldoAtual?: number;
  };
  cliente?: {
    id: string;
    nome: string;
    email: string;
    modulo: string | null;
    saldoAtual?: number;
  };
};

export type SaquePendente = {
  id: string;
  valor: number;
  valorBruto: number;
  criadoEm: string;
};

export type ListSaquesQuery = {
  page?: number;
  pageSize?: number;
  status?: SaqueStatus | 'all';
  /** Admin: formato "YYYY-MM-DD,YYYY-MM-DD" */
  dateRange?: string;
  dataInicio?: string;
  dataFim?: string;
};

export type RequestSaqueResult = {
  data: {
    id: string;
    valor: number;
    valorBruto: number;
    taxa: number;
    status: string;
    chavePix: string;
    modulo: string | null;
  };
  message: string;
};
