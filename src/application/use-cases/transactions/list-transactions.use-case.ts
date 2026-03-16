import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { ListTransactionsQueryDto } from '../../dtos/transactions/list-transactions.query.dto';

function mapInternalStatusToPt(
  status: TransactionStatus,
): 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA' {
  switch (status) {
    case TransactionStatus.COMPLETED:
      return 'APROVADA';
    case TransactionStatus.PENDING:
    case TransactionStatus.DRAFT:
      return 'PENDENTE';
    case TransactionStatus.FAILED:
    case TransactionStatus.EXPIRED:
      return 'RECUSADA';
    case TransactionStatus.REFUNDED:
    case TransactionStatus.CHARGEBACK:
      return 'ESTORNADA';
    default:
      return 'PENDENTE';
  }
}

function mapPtStatusToInternal(
  status: ListTransactionsQueryDto['status'],
): TransactionStatus[] | undefined {
  switch (status) {
    case 'APROVADA':
      return [TransactionStatus.COMPLETED];
    case 'PENDENTE':
      return [TransactionStatus.PENDING, TransactionStatus.DRAFT];
    case 'RECUSADA':
      return [TransactionStatus.FAILED, TransactionStatus.EXPIRED];
    case 'ESTORNADA':
      return [TransactionStatus.REFUNDED, TransactionStatus.CHARGEBACK];
    default:
      return undefined;
  }
}

@Injectable()
export class ListTransactionsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    userId: string;
    query: ListTransactionsQueryDto;
  }): Promise<{
    data: Array<{
      id: string;
      valor: number;
      valorLiquido: number | null;
      status: 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA';
      metodo: 'PIX' | 'CREDIT_CARD';
      descricao: string | null;
      parcelas: number;
      cliente: {
        nome: string | null;
        email: string | null;
        documento: string | null;
      };
      taxas: {
        total: number;
        dom: number;
        plataforma: number;
      };
      criadoEm: string;
    }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;

    const where: Prisma.TransactionWhereInput = {
      userId: input.userId,
    };

    const statuses = mapPtStatusToInternal(input.query.status);
    if (statuses) {
      where.status = { in: statuses };
    }

    if (input.query.metodo) {
      where.paymentMethod =
        input.query.metodo === 'PIX'
          ? PaymentMethod.PIX
          : PaymentMethod.CREDIT_CARD;
    }

    const q = input.query.q?.trim();
    if (q && q.length > 0) {
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { customerEmail: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (input.query.dataInicio || input.query.dataFim) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (input.query.dataInicio) {
        const d = new Date(input.query.dataInicio);
        if (!Number.isNaN(d.getTime())) createdAt.gte = d;
      }
      if (input.query.dataFim) {
        const d = new Date(input.query.dataFim);
        if (!Number.isNaN(d.getTime())) createdAt.lte = d;
      }
      where.createdAt = createdAt;
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: items.map((t) => ({
        id: t.id,
        valor: Number(t.amount),
        valorLiquido: t.netAmount != null ? Number(t.netAmount) : null,
        status: mapInternalStatusToPt(t.status),
        metodo: t.paymentMethod,
        descricao: t.description ?? null,
        parcelas: t.installments,
        cliente: {
          nome: t.customerName ?? null,
          email: t.customerEmail ?? null,
          documento: t.customerDocument ?? null,
        },
        taxas: {
          total: Number(t.totalFee),
          dom: Number(t.domFee),
          plataforma: Number(t.platformFee),
        },
        criadoEm: t.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }
}
