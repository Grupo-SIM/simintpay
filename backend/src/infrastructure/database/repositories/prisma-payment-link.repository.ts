import { createWithCoproduction } from '../../../modules/coproduction/coproduction.service';
import { Injectable } from '@nestjs/common';
import { PaymentLink, Prisma } from '@prisma/client';
import type {
  CreatePaymentLinkData,
  IPaymentLinkRepository,
} from '../../../core/repositories/payment-link.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaPaymentLinkRepository implements IPaymentLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreatePaymentLinkData): Promise<PaymentLink> {
    return createWithCoproduction(
      this.prisma,
      'links-pagamento',
      data.userId,
      data.coproduction,
      (tx) =>
        tx.paymentLink.create({
          data: {
            ...(data.id ? { id: data.id } : {}),
            userId: data.userId,
            createdByUserId: data.createdByUserId,
            title: data.title,
            description: data.description ?? undefined,
            amount: new Prisma.Decimal(data.amount),
            expiresAt: data.expiresAt ?? undefined,
            maxInstallments: data.maxInstallments,
            aceitaCartao: data.aceitaCartao ?? true,
            aceitaPix: data.aceitaPix ?? true,
            aceitaDebito: data.aceitaDebito ?? true,
            isActive: data.isActive ?? true,
            isStandalone: data.isStandalone ?? true,
            platformFee1x: data.platformFee1x ?? 9.0,
            platformFee2x: data.platformFee2x ?? 13.3,
            platformFee3x: data.platformFee3x ?? 14.68,
            platformFee4x: data.platformFee4x ?? 16.04,
            platformFee5x: data.platformFee5x ?? 17.37,
            platformFee6x: data.platformFee6x ?? 18.67,
            platformFee7x: data.platformFee7x ?? 19.95,
            platformFee8x: data.platformFee8x ?? 21.21,
            platformFee9x: data.platformFee9x ?? 22.44,
            platformFee10x: data.platformFee10x ?? 23.64,
            platformFee11x: data.platformFee11x ?? 24.83,
            platformFee12x: data.platformFee12x ?? 25.99,
            cashbackFee: data.cashbackFee ?? 3.0,
            webhookUrl: data.webhookUrl ?? undefined,
            redirectUrl: data.redirectUrl ?? undefined,
            maxUses: data.maxUses ?? undefined,
            domPaymentLinkId: data.domPaymentLinkId ?? undefined,
            emailBody: data.emailBody ?? undefined,
            plataformas: data.plataformas ?? [],
          },
        }),
    );
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

  async findByCode(code: string): Promise<PaymentLink | null> {
    return this.prisma.paymentLink.findUnique({ where: { code } });
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
      expiresAt?: Date | null;
      maxInstallments: number;
      aceitaCartao?: boolean;
      aceitaPix?: boolean;
      aceitaDebito?: boolean;
      isActive: boolean;
      isStandalone: boolean;
      platformFee1x: number;
      platformFee2x: number;
      platformFee3x: number;
      platformFee4x: number;
      platformFee5x: number;
      platformFee6x: number;
      platformFee7x: number;
      platformFee8x: number;
      platformFee9x: number;
      platformFee10x: number;
      platformFee11x: number;
      platformFee12x: number;
      cashbackFee: number;
      webhookUrl?: string | null;
      redirectUrl?: string | null;
      maxUses?: number | null;
      currentUses: number;
      domPaymentLinkId?: string | null;
      emailBody?: string | null;
      plataformas?: string[];
    }>,
  ): Promise<PaymentLink> {
    return this.prisma.paymentLink.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description ?? undefined,
        amount:
          data.amount != null ? new Prisma.Decimal(data.amount) : undefined,
        expiresAt: data.expiresAt ?? undefined,
        maxInstallments: data.maxInstallments,
        aceitaCartao: data.aceitaCartao,
        aceitaPix: data.aceitaPix,
        aceitaDebito: data.aceitaDebito,
        isActive: data.isActive,
        isStandalone: data.isStandalone,
        platformFee1x: data.platformFee1x,
        platformFee2x: data.platformFee2x,
        platformFee3x: data.platformFee3x,
        platformFee4x: data.platformFee4x,
        platformFee5x: data.platformFee5x,
        platformFee6x: data.platformFee6x,
        platformFee7x: data.platformFee7x,
        platformFee8x: data.platformFee8x,
        platformFee9x: data.platformFee9x,
        platformFee10x: data.platformFee10x,
        platformFee11x: data.platformFee11x,
        platformFee12x: data.platformFee12x,
        cashbackFee: data.cashbackFee,
        webhookUrl: data.webhookUrl ?? undefined,
        redirectUrl: data.redirectUrl ?? undefined,
        maxUses: data.maxUses ?? undefined,
        currentUses: data.currentUses,
        domPaymentLinkId: data.domPaymentLinkId ?? undefined,
        ...(data.emailBody !== undefined && { emailBody: data.emailBody }),
        ...(data.plataformas !== undefined && {
          plataformas: data.plataformas,
        }),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.paymentLink.delete({ where: { id } });
  }
}
