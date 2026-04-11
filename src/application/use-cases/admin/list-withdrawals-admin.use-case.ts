import { Injectable } from '@nestjs/common';
import { WithdrawStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

function mapWithdrawStatusToPt(
  status: WithdrawStatus,
): 'PENDENTE' | 'APROVADA' | 'RECUSADA' {
  switch (status) {
    case WithdrawStatus.PENDING:
      return 'PENDENTE';
    case WithdrawStatus.APPROVED:
    case WithdrawStatus.COMPLETED:
      return 'APROVADA';
    case WithdrawStatus.REJECTED:
      return 'RECUSADA';
    default:
      return 'PENDENTE';
  }
}

@Injectable()
export class ListWithdrawalsAdminUseCase {
  constructor(private readonly prisma: PrismaService) { }

  async execute(input: {
    page: number;
    pageSize: number;
    status?: WithdrawStatus;
    moduleSlug?: string;
    userId?: string;
    search?: string;
  }) {
    const skip = (input.page - 1) * input.pageSize;

    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.moduleSlug
        ? { user: { tenantModule: { slug: input.moduleSlug } } }
        : {}),
      ...(input.search
        ? {
            OR: [
              { id: { contains: input.search, mode: 'insensitive' as const } },
              { user: { name: { contains: input.search, mode: 'insensitive' as const } } },
              { user: { email: { contains: input.search, mode: 'insensitive' as const } } },
            ],
          }
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
              externalPlatformUsers: {
                include: { wallet: true },
              },
            },
          },
        },
      }),
      this.prisma.withdrawRequest.count({ where }),
    ]);

    return {
      data: items.map((w) => ({
        id: w.id,
        valor: Number(w.grossAmount), // Valor Bruto (Total deduzido)
        valorLiquido: Number(w.amount), // Valor Líquido (Recebido)
        status: mapWithdrawStatusToPt(w.status),
        metodo: 'PIX',
        descricao: 'Saque SimPay',
        chavePix: w.pixKey,
        comprovante: w.receiptImage ?? null,
        observacao: w.rejectionReason ?? null,
        taxas: {
          total: Number(w.fee),
        },
        cliente: {
          id: w.user.id,
          nome: w.user.name,
          email: w.user.email,
          modulo: w.user.tenantModule
            ? { nome: w.user.tenantModule.name, slug: w.user.tenantModule.slug }
            : null,
          saldoAtual: (() => {
            const slug = w.user.tenantModule?.slug?.toLowerCase();
            const extUser = slug 
              ? w.user.externalPlatformUsers.find(u => u.platform.toLowerCase() === slug)
              : w.user.externalPlatformUsers[0];
            return Number(extUser?.wallet?.balance ?? 0);
          })(),
        },
        criadoEm: w.createdAt.toISOString(),
        atualizadoEm: w.updatedAt.toISOString(),
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }
}
