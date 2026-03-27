import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { ListSubscribersQueryDto } from '../../dtos/subscription/list-subscribers.query.dto';

function mapPlanTypeToFrequency(type: string | null | undefined): string | null {
  switch (type) {
    case 'MONTHLY': return 'MONTH';
    case 'TRIMESTRAL': return 'QUARTER';
    case 'SEMESTRAL': return 'SEMESTER';
    case 'ANUAL': return 'YEAR';
    default: return type ?? null;
  }
}

@Injectable()
export class ListSubscribersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    userId: string;
    role?: string;
    query: ListSubscribersQueryDto;
  }): Promise<{
    data: unknown;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const isAdmin = input.role === 'ADMIN';

    const where: any = {};

    if (!isAdmin) {
      where.userId = input.userId;
    }

    if (input.query.status) {
      where.status = input.query.status;
    }

    if (input.query.planoId) {
      where.planId = input.query.planoId;
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          plan: { select: { id: true, name: true, description: true, price: true, type: true } },
          customer: { select: { name: true, email: true, document: true, phone: true } },
          user: { select: { cpf: true } },
        },
      }),
    ]);

    return {
      data: items.map((s: any) => ({
        id: s.id,
        status: s.status ?? null,
        nome: s.customer?.name ?? null,
        descricao: s.plan?.description ?? s.plan?.name ?? null,
        valor: s.plan?.price ? Number(s.plan.price) : null,
        frequencia: mapPlanTypeToFrequency(s.plan?.type),
        intervalo: 1,
        ciclo: 0,
        formaPagamento: 'credit_card',
        primeiraCobranca: s.createdAt?.toISOString() ?? null,
        proximaCobranca: s.expiresAt?.toISOString() ?? null,
        planoId: s.planId ?? null,
        planNome: s.plan?.name ?? null,
        cliente: s.customer
          ? {
              nome: s.customer.name ?? null,
              email: s.customer.email ?? null,
              documento: s.customer.document ?? null,
              telefone: s.customer.phone ?? null,
            }
          : null,
        criadoEm: s.createdAt?.toISOString() ?? null,
      })),
      page,
      pageSize,
      total,
    };
  }
}
