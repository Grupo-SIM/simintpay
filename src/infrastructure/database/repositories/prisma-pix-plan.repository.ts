import { Injectable } from '@nestjs/common';
import type { IPixPlanRepository } from '../../../core/repositories/pix-plan.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaPixPlanRepository implements IPixPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPixCreditPlan(data: {
    userId: string;
    type: string;
    price: number;
    description?: string;
    redirectUrl?: string;
    webhookUrl?: string;
    tenantTag?: string | null;
    emailBody?: string | null;
  }) {
    return (this.prisma as any).pixCreditPlan.create({
      data: {
        userId: data.userId,
        type: data.type,
        price: data.price,
        description: data.description,
        redirectUrl: data.redirectUrl,
        webhookUrl: data.webhookUrl,
        tenantTag: data.tenantTag ?? null,
        emailBody: data.emailBody ?? null,
      },
    });
  }

  async findPixCreditPlanById(id: string) {
    return (this.prisma as any).pixCreditPlan.findUnique({
      where: { id },
    });
  }

  async updatePixCreditPlanStatus(id: string, status: 'ACTIVE' | 'INACTIVE') {
    await (this.prisma as any).pixCreditPlan.update({
      where: { id },
      data: { status },
    });
  }

  async findPixCreditPlansByUserId(userId: string) {
    return (this.prisma as any).pixCreditPlan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        linkCodes: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findPixCreditPlansByUserIdPaginated(params: {
    userId?: string;
    page: number;
    limit: number;
    status?: 'ACTIVE' | 'INACTIVE';
    search?: string;
  }) {
    const { userId, page, limit, status, search } = params;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (status) {
      where.status = status;
    }

    if (search?.trim()) {
      where.OR = [
        { description: { contains: search.trim(), mode: 'insensitive' } },
        { type: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).pixCreditPlan.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          linkCodes: {
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          user: { select: { cpf: true, name: true, email: true } },
          _count: { select: { accesses: true } },
        },
      }),
      (this.prisma as any).pixCreditPlan.count({ where }),
    ]);

    return { items, total };
  }

  async deletePixCreditPlan(id: string) {
    await (this.prisma as any).pixCreditPlan.delete({ where: { id } });
  }

  async deletePixPlanLinkCodesByPlanId(planId: string) {
    await (this.prisma as any).pixPlanLinkCode.deleteMany({
      where: { pixCreditPlanId: planId },
    });
  }

  async createPixPlanLinkCode(data: { pixCreditPlanId: string; code: string }) {
    return (this.prisma as any).pixPlanLinkCode.create({ data });
  }

  async findPixPlanLinkCodeByCode(code: string) {
    return (this.prisma as any).pixPlanLinkCode.findUnique({
      where: { code },
    });
  }

  async findPixPlanLinkCodeByCodeWithPlan(code: string) {
    return (this.prisma as any).pixPlanLinkCode.findUnique({
      where: { code },
      include: { pixCreditPlan: true },
    });
  }

  async createPixPlanOrder(data: {
    transactionId: string;
    userId: string;
    customerEmail: string;
    customerDocument: string;
    planType: string;
    daysCredited: number;
    pixCreditPlanId?: string | null;
    customerId?: string;
    paid?: boolean;
  }) {
    return (this.prisma as any).pixPlanOrder.create({
      data: {
        transactionId: data.transactionId,
        userId: data.userId,
        customerEmail: data.customerEmail,
        customerDocument: data.customerDocument,
        planType: data.planType,
        daysCredited: data.daysCredited,
        pixCreditPlanId: data.pixCreditPlanId || null,
        customerId: data.customerId || null,
        paid: data.paid ?? false,
      },
    });
  }

  async findPixPlanOrderByTransactionId(transactionId: string) {
    return (this.prisma as any).pixPlanOrder.findUnique({
      where: { transactionId },
      include: { user: true, pixCreditPlan: { include: { linkCodes: true } } },
    });
  }

  async updatePixPlanOrderPaid(
    transactionId: string,
    data: { paid: boolean; creditedAt: Date; customerId: string },
  ) {
    await (this.prisma as any).pixPlanOrder.update({
      where: { transactionId },
      data: {
        paid: data.paid,
        creditedAt: data.creditedAt,
        customerId: data.customerId,
      },
    });
  }

  async findCustomerPlanAccess(params: {
    userId: string;
    customerDocument: string;
    pixPlanId: string;
  }) {
    return (this.prisma as any).customerPlanAccess.findUnique({
      where: {
        userId_customerDocument_pixPlanId: {
          userId: params.userId,
          customerDocument: params.customerDocument,
          pixPlanId: params.pixPlanId,
        },
      },
    });
  }

  async findActiveCustomerPlanAccess(params: {
    userId: string;
    customerDocument: string;
  }) {
    return (this.prisma as any).customerPlanAccess.findFirst({
      where: {
        userId: params.userId,
        customerDocument: params.customerDocument,
        isActive: true,
      },
      orderBy: { expiresAt: 'desc' },
    });
  }

  async createCustomerPlanAccess(data: {
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
  }) {
    return (this.prisma as any).customerPlanAccess.create({ data });
  }

  async updateCustomerPlanAccess(
    params: {
      userId: string;
      customerDocument: string;
      pixPlanId: string;
    },
    data: {
      isActive?: boolean;
      expiresAt?: Date;
      totalDaysCredited?: number;
      lastTransactionId?: string;
      customerId?: string;
      pixPlanCode?: string | null;
    },
  ) {
    await (this.prisma as any).customerPlanAccess.update({
      where: {
        userId_customerDocument_pixPlanId: {
          userId: params.userId,
          customerDocument: params.customerDocument,
          pixPlanId: params.pixPlanId,
        },
      },
      data,
    });
  }

  async updateCustomerPlanAccessById(
    id: string,
    data: {
      isActive?: boolean;
      expiresAt?: Date;
      totalDaysCredited?: number;
      createdAt?: Date;
    },
  ) {
    await (this.prisma as any).customerPlanAccess.update({
      where: { id },
      data,
    });
  }

  async findCustomerPlanAccessById(id: string) {
    return (this.prisma as any).customerPlanAccess.findUnique({
      where: { id },
    });
  }

  async listAllCustomerPlanAccess(params: {
    page: number;
    limit: number;
    userId?: string;
    isActive?: boolean;
    pixPlanId?: string;
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    const { page, limit, userId, isActive, pixPlanId, search, dateFrom, dateTo } = params;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (userId) {
      if (userId.includes('@')) {
        const user = await this.prisma.user.findUnique({
          where: { email: userId },
          select: { id: true },
        });
        if (!user) return { items: [], total: 0 };
        where.userId = user.id;
      } else {
        where.userId = userId;
      }
    }

    if (isActive !== undefined) where.isActive = isActive;
    if (pixPlanId) where.pixPlanId = pixPlanId;

    if (search?.trim()) {
      const s = search.trim();
      where.OR = [
        { customerEmail: { contains: s, mode: 'insensitive' } },
        { customerDocument: { contains: s, mode: 'insensitive' } },
        { customer: { name: { contains: s, mode: 'insensitive' } } },
        { customer: { email: { contains: s, mode: 'insensitive' } } },
      ];
    }

    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom && { gte: dateFrom }),
        ...(dateTo && { lte: new Date(dateTo.getTime() + 86399999) }),
      };
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).customerPlanAccess.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              document: true,
              documentType: true,
            },
          },
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      (this.prisma as any).customerPlanAccess.count({ where }),
    ]);

    return { items, total };
  }

  async findAllActiveCustomerPlanAccess() {
    return (this.prisma as any).customerPlanAccess.findMany({
      where: { isActive: true },
      include: {
        user: { select: { name: true, email: true } },
      },
    });
  }

  async findCustomerPlanAccessByPlanId(planId: string) {
    return (this.prisma as any).customerPlanAccess.findMany({
      where: { pixPlanId: planId },
    });
  }
}
