export type LeadStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  cpf?: string;
  razaoSocial?: string | null;
  cnpj?: string | null;
  faturamento?: string | null;
  tempoOperacao?: string | null;
  modeloOperacao?: string;
  cargo?: string | null;
  comoConheceu?: string;
  status: LeadStatus;
  createdAt: string;
};

export type ListLeadsQuery = {
  page?: number;
  pageSize?: number;
  status?: LeadStatus;
};
