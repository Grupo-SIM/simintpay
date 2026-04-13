export const PIX_PLAN_REPOSITORY = Symbol('PIX_PLAN_REPOSITORY');

export interface IPixPlanRepository {
  // PixCreditPlan
  createPixCreditPlan(data: {
    userId: string;
    type: string;
    price: number;
    description?: string;
    redirectUrl?: string;
    webhookUrl?: string;
  }): Promise<any>;

  findPixCreditPlanById(id: string): Promise<any>;

  updatePixCreditPlanStatus(id: string, status: 'ACTIVE' | 'INACTIVE'): Promise<void>;

  findPixCreditPlansByUserId(userId: string): Promise<any[]>;
  findPixCreditPlansByUserIdPaginated(params: {
    userId?: string;
    page: number;
    limit: number;
    status?: 'ACTIVE' | 'INACTIVE';
    search?: string;
  }): Promise<{ items: any[]; total: number }>;

  deletePixCreditPlan(id: string): Promise<void>;

  deletePixPlanLinkCodesByPlanId(planId: string): Promise<void>;

  // PixPlanLinkCode
  createPixPlanLinkCode(data: {
    pixCreditPlanId: string;
    code: string;
  }): Promise<any>;

  findPixPlanLinkCodeByCode(code: string): Promise<any>;

  findPixPlanLinkCodeByCodeWithPlan(code: string): Promise<any>;

  // PixPlanOrder
  createPixPlanOrder(data: {
    transactionId: string;
    userId: string;
    customerEmail: string;
    customerDocument: string;
    planType: string;
    daysCredited: number;
    pixCreditPlanId?: string | null;
    customerId?: string;
    paid?: boolean;
  }): Promise<any>;

  findPixPlanOrderByTransactionId(transactionId: string): Promise<any>;

  updatePixPlanOrderPaid(transactionId: string, data: {
    paid: boolean;
    creditedAt: Date;
    customerId: string;
  }): Promise<void>;

  // CustomerPlanAccess
  findCustomerPlanAccess(params: {
    userId: string;
    customerDocument: string;
    pixPlanId: string;
  }): Promise<any>;

  findActiveCustomerPlanAccess(params: {
    userId: string;
    customerDocument: string;
  }): Promise<any>;

  createCustomerPlanAccess(data: {
    userId: string;
    customerId: string;
    customerEmail: string;
    customerDocument: string;
    pixPlanId: string;
    pixPlanCode?: string | null;
    isActive: boolean;
    expiresAt: Date;
    totalDaysCredited: number;
    lastTransactionId: string;
  }): Promise<any>;

  updateCustomerPlanAccess(params: {
    userId: string;
    customerDocument: string;
    pixPlanId: string;
  }, data: {
    isActive?: boolean;
    expiresAt?: Date;
    totalDaysCredited?: number;
    lastTransactionId?: string;
    customerId?: string;
    pixPlanCode?: string | null;
  }): Promise<void>;

  updateCustomerPlanAccessById(id: string, data: {
    isActive?: boolean;
    expiresAt?: Date;
    totalDaysCredited?: number;
    createdAt?: Date;
  }): Promise<void>;

  findCustomerPlanAccessById(id: string): Promise<any>;

  listAllCustomerPlanAccess(params: {
    page: number;
    limit: number;
    userId?: string;
    isActive?: boolean;
    pixPlanId?: string;
  }): Promise<{ items: any[]; total: number }>;

  findAllActiveCustomerPlanAccess(): Promise<any[]>;

  findCustomerPlanAccessByPlanId(planId: string): Promise<any[]>;
}
