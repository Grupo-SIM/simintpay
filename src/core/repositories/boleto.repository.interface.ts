import type { Boleto } from '@prisma/client';

export const BOLETO_REPOSITORY = Symbol('BOLETO_REPOSITORY');

export type CreateBoletoData = {
  userId: string;
  title: string;
  description?: string | null;
  amount: number;
  expiresAt?: Date | null;
  vencimentoDias?: number;
  isActive?: boolean;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  maxUses?: number | null;
  domPaymentLinkId?: string | null;
  domLink?: string | null;
  plataformas?: string[];
};

export interface IBoletoRepository {
  create(data: CreateBoletoData): Promise<Boleto>;
  findManyByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: Boleto[] }>;
  findAll(input: {
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: Boleto[] }>;
  findById(id: string): Promise<Boleto | null>;
  findByCode(code: string): Promise<Boleto | null>;
  findByIdForUser(input: { id: string; userId: string }): Promise<Boleto | null>;
  update(
    id: string,
    data: Partial<Omit<CreateBoletoData, 'userId'> & { currentUses: number }>,
  ): Promise<Boleto>;
  delete(id: string): Promise<void>;
}
