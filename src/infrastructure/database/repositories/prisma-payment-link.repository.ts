import { Injectable } from '@nestjs/common';
import { PaymentLink, Prisma } from '@prisma/client';
import type { CreatePaymentLinkData, IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaPaymentLinkRepository implements IPaymentLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreatePaymentLinkData): Promise<PaymentLink> {
    return this.prisma.paymentLink.create({
      data: {
        userId: data.userId,
        title: data.title,
        description: data.description ?? undefined,
        amount: new Prisma.Decimal(data.amount),
        maxInstallments: data.maxInstallments,
        aceitaCartao: data.aceitaCartao ?? true,
        aceitaPix: data.aceitaPix ?? true,
        isActive: data.isActive ?? true,
        domPaymentLinkId: data.domPaymentLinkId ?? undefined,
      },
    });
  }

  async findManyByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: PaymentLink[] }> {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.paymentLink.count({ where: { userId: input.userId } }),
      this.prisma.paymentLink.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);

    return { total, items };
  }

  async findAll(input: {
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: PaymentLink[] }> {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.paymentLink.count(),
      this.prisma.paymentLink.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);

    return { total, items };
  }

  async findById(id: string): Promise<PaymentLink | null> {
    return this.prisma.paymentLink.findUnique({ where: { id } });
  }

  async findByIdForUser(input: {
    id: string;
    userId: string;
  }): Promise<PaymentLink | null> {
    return this.prisma.paymentLink.findFirst({
      where: { id: input.id, userId: input.userId },
    });
  }

  async update(
    id: string,
    data: Partial<{
      title: string;
      description?: string | null;
      amount: number;
      maxInstallments: number;
      isActive: boolean;
      domPaymentLinkId?: string | null;
    }>,
  ): Promise<PaymentLink> {
    return this.prisma.paymentLink.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description ?? undefined,
        amount:
          data.amount != null ? new Prisma.Decimal(data.amount) : undefined,
        maxInstallments: data.maxInstallments,
        isActive: data.isActive,
        domPaymentLinkId: data.domPaymentLinkId ?? undefined,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.paymentLink.delete({ where: { id } });
  }
}
