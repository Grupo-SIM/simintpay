import { Lead, LeadStatus } from '@prisma/client';

export const LEAD_REPOSITORY = Symbol('LEAD_REPOSITORY');

export type CreateLeadData = {
  name: string;
  phone: string;
  email: string;
  razaoSocial: string;
  cnpj: string;
  cpf?: string;
  faturamento: string;
  tempoOperacao: string;
  modeloOperacao?: string;
  cargo: string;
  comoConheceu?: string;
  referredByCode?: string;
};

export interface ILeadRepository {
  create(data: CreateLeadData): Promise<Lead>;
  hasIdentityConflict(
    email: string,
    cpf: string,
    cnpj: string,
  ): Promise<boolean>;
  findById(id: string): Promise<Lead | null>;
  findByIds(ids: string[]): Promise<Lead[]>;
  list(query: {
    page: number;
    pageSize: number;
    status?: LeadStatus;
  }): Promise<{ data: Lead[]; total: number }>;
  approve(id: string, approvedUserId: string): Promise<Lead>;
  reject(id: string, reason?: string): Promise<Lead>;
  deleteMany(ids: string[]): Promise<number>;
}
