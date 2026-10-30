export type LeadStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  cpf?: string;
  razaoSocial: string;
  cnpj: string;
  faturamento: string;
  tempoOperacao: string;
  modeloOperacao?: string;
  cargo: string;
  comoConheceu?: string;
  status: LeadStatus;
  createdAt: string;
};

export type ListLeadsQuery = {
  page?: number;
  pageSize?: number;
  status?: LeadStatus;
};
