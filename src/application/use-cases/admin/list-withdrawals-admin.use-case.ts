import { Injectable } from '@nestjs/common';
import { WithdrawStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class ListWithdrawalsAdminUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    page: number;
    pageSize: number;
    status?: WithdrawStatus;
    moduleSlug?: string;
  }) {
    const skip = (input.page - 1) * input.pageSize;

    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.moduleSlug
        ? { user: { tenantModule: { slug: input.moduleSlug } } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.withdrawRequest.findMany({
        where,
        skip,
        take: input.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              tenantModule: { select: { name: true, slug: true } },
            },
          },
        },
      }),
      this.prisma.withdrawRequest.count({ where }),
    ]);

    return {
      data: items.map((w) => ({
        id: w.id,
        valor: Number(w.amount),
        valorBruto: Number(w.grossAmount),
        taxa: Number(w.fee),
        status: w.status,
        chavePix: w.pixKey,
        comprovante: w.receiptImage ?? null,
        observacao: w.rejectionReason ?? null,
        criadoEm: w.createdAt.toISOString(),
        atualizadoEm: w.updatedAt.toISOString(),
        usuario: {
          id: w.user.id,
          nome: w.user.name,
          email: w.user.email,
          modulo: w.user.tenantModule
            ? { nome: w.user.tenantModule.name, slug: w.user.tenantModule.slug }
            : null,
        },
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }
}
