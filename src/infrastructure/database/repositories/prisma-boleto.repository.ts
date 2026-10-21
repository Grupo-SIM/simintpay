import { createWithCoproduction } from '../../../modules/coproduction/coproduction.service';
import { Injectable } from '@nestjs/common';
import { Boleto, Prisma } from '@prisma/client';
import type { CreateBoletoData, IBoletoRepository } from '../../../core/repositories/boleto.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaBoletoRepository implements IBoletoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateBoletoData): Promise<Boleto> {
    return createWithCoproduction(this.prisma, 'boletos', data.userId, data.coproduction, tx => tx.boleto.create({
      data: {
        userId: data.userId,
        title: data.title,
        description: data.description ?? undefined,
        amount: new Prisma.Decimal(data.amount),
        expiresAt: data.expiresAt ?? undefined,
        vencimentoDias: data.vencimentoDias ?? 3,
        isActive: data.isActive ?? true,
        webhookUrl: data.webhookUrl ?? undefined,
        redirectUrl: data.redirectUrl ?? undefined,
        maxUses: data.maxUses ?? undefined,
        domPaymentLinkId: data.domPaymentLinkId ?? undefined,
        domLink: data.domLink ?? undefined,
        plataformas: data.plataformas ?? [],
      },
    }));
  }

  async findManyByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: Boleto[] }> {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.boleto.count({ where: { userId: input.userId } }),
      this.prisma.boleto.findMany({
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
  }): Promise<{ total: number; items: Boleto[] }> {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.boleto.count(),
      this.prisma.boleto.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);

    return { total, items };
  }

  async findById(id: string): Promise<Boleto | null> {
    return this.prisma.boleto.findUnique({ where: { id } });
  }

  async findByCode(code: string): Promise<Boleto | null> {
    return this.prisma.boleto.findUnique({ where: { code } });
  }

  async findByIdForUser(input: { id: string; userId: string }): Promise<Boleto | null> {
    return this.prisma.boleto.findFirst({
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
      vencimentoDias: number;
      isActive: boolean;
      webhookUrl?: string | null;
      redirectUrl?: string | null;
      maxUses?: number | null;
      currentUses: number;
      domPaymentLinkId?: string | null;
      domLink?: string | null;
      plataformas?: string[];
    }>,
  ): Promise<Boleto> {
    return this.prisma.boleto.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description ?? undefined,
        amount: data.amount != null ? new Prisma.Decimal(data.amount) : undefined,
        expiresAt: data.expiresAt ?? undefined,
        vencimentoDias: data.vencimentoDias,
        isActive: data.isActive,
        webhookUrl: data.webhookUrl ?? undefined,
        redirectUrl: data.redirectUrl ?? undefined,
        maxUses: data.maxUses ?? undefined,
        currentUses: data.currentUses,
        domPaymentLinkId: data.domPaymentLinkId ?? undefined,
        domLink: data.domLink ?? undefined,
        ...(data.plataformas !== undefined && { plataformas: data.plataformas }),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.boleto.delete({ where: { id } });
  }
}
