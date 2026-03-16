import type { PaymentLink } from '@prisma/client';

export const PAYMENT_LINK_REPOSITORY = Symbol('PAYMENT_LINK_REPOSITORY');

export type CreatePaymentLinkData = {
  userId: string;
  title: string;
  description?: string | null;
  amount: number;
  maxInstallments: number;
  isActive?: boolean;
  domPaymentLinkId?: string | null;
};

export interface IPaymentLinkRepository {
  create(data: CreatePaymentLinkData): Promise<PaymentLink>;
  findManyByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: PaymentLink[] }>;
  findById(id: string): Promise<PaymentLink | null>;
  findByIdForUser(input: {
    id: string;
    userId: string;
  }): Promise<PaymentLink | null>;
  update(
    id: string,
    data: Partial<Omit<CreatePaymentLinkData, 'userId'>>,
  ): Promise<PaymentLink>;
  delete(id: string): Promise<void>;
}
