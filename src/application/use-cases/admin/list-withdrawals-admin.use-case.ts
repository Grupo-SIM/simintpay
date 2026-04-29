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

    // Each OR group is collected separately to avoid key collision when spreading
    const andConditions: object[] = [];

    if (input.moduleSlug) {
      // Match pelo campo platform gravado na criação, ou fallback para tenantModule do usuário
      andConditions.push({
        OR: [
          { platform: { equals: input.moduleSlug, mode: 'insensitive' as const } },
          { user: { tenantModule: { slug: { equals: input.moduleSlug, mode: 'insensitive' as const } } } },
        ],
      });
    }

    if (input.search) {
      andConditions.push({
        OR: [
          { id: { contains: input.search, mode: 'insensitive' as const } },
          { user: { name: { contains: input.search, mode: 'insensitive' as const } } },
          { user: { email: { contains: input.search, mode: 'insensitive' as const } } },
        ],
      });
    }

    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
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
        valor: Number(w.grossAmount),
        valorLiquido: Number(w.amount),
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
          modulo: (() => {
            // Prioridade: campo platform gravado na criação > tenantModule do usuário
            if (w.platform) {
              return { nome: w.platform, slug: w.platform.toLowerCase() };
            }
            if (w.user.tenantModule) {
              return { nome: w.user.tenantModule.name, slug: w.user.tenantModule.slug };
            }
            return null;
          })(),
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
