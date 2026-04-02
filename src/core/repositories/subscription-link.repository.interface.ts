import type { SubscriptionLink, SubscriptionLinkOrder } from '@prisma/client';

export const SUBSCRIPTION_LINK_REPOSITORY = Symbol('SUBSCRIPTION_LINK_REPOSITORY');

export type CreateSubscriptionLinkData = {
  userId: string;
  ownerEmail?: string | null;
  name: string;
  description?: string | null;
  amount: number;
  frequencyType: string;
  isStandalone?: boolean;
  platformFee?: number;
  redirectUrl?: string | null;
  webhookUrl?: string | null;
  maxUses?: number | null;
  domPlanId?: string | null;
  paymentMethods?: string;
};

export type CreateSubscriptionLinkOrderData = {
  subscriptionLinkId: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone?: string | null;
  paymentMethod: 'CREDIT_CARD' | 'PIX';
  status: string;
  domSubscriptionId?: string | null;
  domPixPaymentId?: string | null;
  pixContent?: string | null;
  pixExpire?: Date | null;
  amountCharged: number;
  platformFeeAmount: number;
};

export interface ISubscriptionLinkRepository {
  create(data: CreateSubscriptionLinkData): Promise<SubscriptionLink>;
  findById(id: string): Promise<SubscriptionLink | null>;
  findByCode(code: string): Promise<SubscriptionLink | null>;
  findByIdForUser(input: { id: string; userId: string }): Promise<SubscriptionLink | null>;
  findManyByUserId(input: { userId: string; page: number; pageSize: number }): Promise<{ total: number; items: SubscriptionLink[] }>;
  findAll(input: { page: number; pageSize: number }): Promise<{ total: number; items: SubscriptionLink[] }>;
  update(id: string, data: Partial<Omit<CreateSubscriptionLinkData, 'userId'> & { isActive: boolean; currentUses: number }>): Promise<SubscriptionLink>;
  delete(id: string): Promise<void>;
  createOrder(data: CreateSubscriptionLinkOrderData): Promise<SubscriptionLinkOrder>;
  findOrdersByLinkId(input: { linkId: string; page: number; pageSize: number }): Promise<{ total: number; items: SubscriptionLinkOrder[] }>;
  findOrdersByUserId(input: { userId: string; page: number; pageSize: number }): Promise<{ total: number; items: any[] }>;
}
