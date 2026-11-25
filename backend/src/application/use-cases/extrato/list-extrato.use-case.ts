import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { ListExtratoQueryDto } from '../../dtos/extrato/list-extrato.query.dto';

dayjs.extend(utc);
dayjs.extend(timezone);

const BRT = 'America/Sao_Paulo';

/** Lançamentos de saldo (BalanceLog) do próprio usuário; nunca expõe source/metadata internos. */
@Injectable()
export class ListExtratoUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: { userId: string; query: ListExtratoQueryDto }) {
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;
    const { dataInicio, dataFim, tipo, natureza, busca } = input.query;

    // Lançamentos sem efeito no saldo (ex.: contábeis administrativos) não são alterações de saldo.
    const and: Prisma.BalanceLogWhereInput[] = [
      { OR: [{ balanceDelta: { not: 0 } }, { lockedDelta: { not: 0 } }] },
    ];

    if (dataInicio || dataFim) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (dataInicio) {
        createdAt.gte = dayjs.tz(dataInicio, BRT).startOf('day').toDate();
      }
      if (dataFim) {
        createdAt.lte = dayjs.tz(dataFim, BRT).endOf('day').toDate();
      }
      and.push({ createdAt });
    }

    if (tipo === 'ENTRADA') and.push({ balanceDelta: { gt: 0 } });
    if (tipo === 'SAIDA') and.push({ balanceDelta: { lt: 0 } });
    if (natureza && natureza !== 'all') and.push({ nature: natureza });
    if (busca?.trim()) {
      and.push({
        description: { contains: busca.trim(), mode: 'insensitive' },
      });
    }

    const where: Prisma.BalanceLogWhereInput = {
      userId: input.userId,
      AND: and,
    };

    const [items, total, credits, debits] = await Promise.all([
      this.prisma.balanceLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          action: true,
          nature: true,
          description: true,
          transactionId: true,
          balanceDelta: true,
          lockedDelta: true,
          createdAt: true,
        },
      }),
      this.prisma.balanceLog.count({ where }),
      this.prisma.balanceLog.aggregate({
        where: { AND: [where, { balanceDelta: { gt: 0 } }] },
        _sum: { balanceDelta: true },
      }),
      this.prisma.balanceLog.aggregate({
        where: { AND: [where, { balanceDelta: { lt: 0 } }] },
        _sum: { balanceDelta: true },
      }),
    ]);

    return {
      data: items.map((item) => ({
        id: item.id,
        action: item.action,
        natureza: item.nature,
        descricao: item.description,
        transacaoId: item.transactionId,
        valor: Number(item.balanceDelta),
        valorBloqueado: Number(item.lockedDelta),
        criadoEm: item.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      resumo: {
        entradas: Number(credits._sum.balanceDelta ?? 0),
        saidas: Math.abs(Number(debits._sum.balanceDelta ?? 0)),
      },
    };
  }
}
