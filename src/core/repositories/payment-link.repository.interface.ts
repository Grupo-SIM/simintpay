import type { PaymentLink } from '@prisma/client';

export const PAYMENT_LINK_REPOSITORY = Symbol('PAYMENT_LINK_REPOSITORY');

export type CreatePaymentLinkData = {
  userId: string;
  title: string;
  description?: string | null;
  amount: number;
  expiresAt?: Date | null;
  maxInstallments: number;
  aceitaCartao?: boolean;
  aceitaDebito?: boolean;
  aceitaPix?: boolean;
  isActive?: boolean;
  isStandalone?: boolean;
  platformFee1x?: number;
  platformFee2x?: number;
  platformFee3x?: number;
  platformFee4x?: number;
  platformFee5x?: number;
  platformFee6x?: number;
  platformFee7x?: number;
  platformFee8x?: number;
  platformFee9x?: number;
  platformFee10x?: number;
  platformFee11x?: number;
  platformFee12x?: number;
  cashbackFee?: number;
  debitFeePercent?: number;
  debitFeeFixed?: number;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  maxUses?: number | null;
  domPaymentLinkId?: string | null;
  emailBody?: string | null;
  plataformas?: string[];
};

export interface IPaymentLinkRepository {
  create(data: CreatePaymentLinkData): Promise<PaymentLink>;
  findManyByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: PaymentLink[] }>;
  findAll(input: {
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: PaymentLink[] }>;
  findById(id: string): Promise<PaymentLink | null>;
  findByCode(code: string): Promise<PaymentLink | null>;
  findByIdForUser(input: {
    id: string;
    userId: string;
  }): Promise<PaymentLink | null>;
  update(
    id: string,
    data: Partial<Omit<CreatePaymentLinkData, 'userId'> & { currentUses: number }>,
  ): Promise<PaymentLink>;
  delete(id: string): Promise<void>;
}
