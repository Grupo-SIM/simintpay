import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, SubscriptionLink, SubscriptionLinkOrder } from '@prisma/client';
import type {
  CreateSubscriptionLinkData,
  CreateSubscriptionLinkOrderData,
  ISubscriptionLinkRepository,
} from '../../../core/repositories/subscription-link.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaSubscriptionLinkRepository implements ISubscriptionLinkRepository {
  constructor(private readonly prisma: PrismaService) { }

  async create(data: CreateSubscriptionLinkData): Promise<SubscriptionLink> {
    return this.prisma.subscriptionLink.create({
      data: {
        userId: data.userId,
        ownerEmail: data.ownerEmail ?? undefined,
        name: data.name,
        description: data.description ?? undefined,
        amount: new Prisma.Decimal(data.amount),
        frequencyType: data.frequencyType as any,
        isStandalone: data.isStandalone ?? true,
        platformFee: data.platformFee ?? 9.0,
        redirectUrl: data.redirectUrl ?? undefined,
        webhookUrl: data.webhookUrl ?? undefined,
        maxUses: data.maxUses ?? undefined,
        domPlanId: data.domPlanId ?? undefined,
        platformTag: data.platformTag ?? undefined,
        emailBody: data.emailBody ?? undefined,
        plataformas: data.plataformas ?? [],
      },
    });
  }

  async findById(id: string): Promise<SubscriptionLink | null> {
    return this.prisma.subscriptionLink.findUnique({ where: { id } });
  }

  async findByCode(code: string): Promise<SubscriptionLink | null> {
    return this.prisma.subscriptionLink.findUnique({ where: { code } });
  }

  async findByIdForUser(input: { id: string; userId: string }): Promise<SubscriptionLink | null> {
    return this.prisma.subscriptionLink.findFirst({
      where: { id: input.id, userId: input.userId },
    });
  }

  async findManyByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: SubscriptionLink[] }> {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.subscriptionLink.count({ where: { userId: input.userId } }),
      this.prisma.subscriptionLink.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: { user: { select: { name: true, email: true, cpf: true, clientStatus: true } } },
      }),
    ]);
    return { total, items };
  }

  async findAll(input: { page: number; pageSize: number }): Promise<{ total: number; items: SubscriptionLink[] }> {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.subscriptionLink.count(),
      this.prisma.subscriptionLink.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: { user: { select: { name: true, email: true, cpf: true, clientStatus: true } } },
      }),
    ]);
    return { total, items };
  }

  async update(
    id: string,
    data: Partial<Omit<CreateSubscriptionLinkData, 'userId'> & { isActive: boolean; currentUses: number }>,
  ): Promise<SubscriptionLink> {
    return this.prisma.subscriptionLink.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description ?? undefined,
        amount: data.amount != null ? new Prisma.Decimal(data.amount) : undefined,
        frequencyType: data.frequencyType != null ? (data.frequencyType as any) : undefined,
        paymentMethods: data.paymentMethods ?? undefined,
        isStandalone: data.isStandalone,
        platformFee: data.platformFee,
        isActive: data.isActive,
        redirectUrl: data.redirectUrl ?? undefined,
        webhookUrl: data.webhookUrl ?? undefined,
        maxUses: data.maxUses ?? undefined,
        currentUses: data.currentUses,
        // null explícito limpa o domPlanId (força recriação do plano na DOM no próximo
        // checkout de cartão); undefined mantém o valor atual.
        domPlanId: data.domPlanId === null ? null : (data.domPlanId ?? undefined),
        platformTag: data.platformTag ?? undefined,
        ...(data.emailBody !== undefined && { emailBody: data.emailBody }),
        ...(data.plataformas !== undefined && { plataformas: data.plataformas }),
      },
    });
  }

  async delete(id: string): Promise<void> {
    // Orders têm FK sem cascade — apaga os orders dependentes antes do link.
    // (CommunityLinkBinding tem onDelete: Cascade e CommunitySubscriptionEvent tem SetNull.)
    await this.prisma.$transaction([
      this.prisma.subscriptionLinkOrder.deleteMany({ where: { subscriptionLinkId: id } }),
      this.prisma.subscriptionLink.delete({ where: { id } }),
    ]);
  }

  async createOrder(data: CreateSubscriptionLinkOrderData): Promise<SubscriptionLinkOrder> {
    return this.prisma.subscriptionLinkOrder.create({
      data: {
        subscriptionLinkId: data.subscriptionLinkId,
        userId: data.userId,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerDocument: data.customerDocument,
        customerPhone: data.customerPhone ?? undefined,
        paymentMethod: data.paymentMethod === 'PIX' ? PaymentMethod.PIX : PaymentMethod.CREDIT_CARD,
        status: data.status,
        domSubscriptionId: data.domSubscriptionId ?? undefined,
        domPixPaymentId: data.domPixPaymentId ?? undefined,
        pixContent: data.pixContent ?? undefined,
        pixExpire: data.pixExpire ?? undefined,
        financialSnapshot: data.financialSnapshot,
        amountCharged: new Prisma.Decimal(data.amountCharged),
        platformFeeAmount: new Prisma.Decimal(data.platformFeeAmount),
        currentPeriodEndsAt: data.currentPeriodEndsAt ?? undefined,
      },
    });
  }

  async findOrdersByLinkId(input: {
    linkId: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: SubscriptionLinkOrder[] }> {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.subscriptionLinkOrder.count({ where: { subscriptionLinkId: input.linkId } }),
      this.prisma.subscriptionLinkOrder.findMany({
        where: { subscriptionLinkId: input.linkId },
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return { total, items };
  }

  async findOrdersByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: (SubscriptionLinkOrder & { subscriptionLink: { name: string; amount: unknown; platformFee: unknown } })[] }> {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.subscriptionLinkOrder.count({ where: { userId: input.userId } }),
      this.prisma.subscriptionLinkOrder.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: { subscriptionLink: { select: { name: true, amount: true, platformFee: true } } },
      }),
    ]);
    return { total, items } as any;
  }
}
