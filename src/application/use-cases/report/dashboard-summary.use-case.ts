import { Injectable } from '@nestjs/common';
import { Prisma, TransactionStatus, WithdrawStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

@Injectable()
export class DashboardSummaryUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: { userId: string }): Promise<{ data: unknown }> {
    const now = new Date();

    const todayStart = startOfDay(now);
    const weekStart = new Date(todayStart);
    weekStart.setDate(todayStart.getDate() - 7);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
      999,
    );

    const completedWhere: Prisma.TransactionWhereInput = {
      userId: input.userId,
      status: TransactionStatus.COMPLETED,
    };

    const [txTotal, txApproved, txPending, txRejected, txRefunded] =
      await this.prisma.$transaction([
        this.prisma.transaction.count({ where: { userId: input.userId } }),
        this.prisma.transaction.count({
          where: { userId: input.userId, status: TransactionStatus.COMPLETED },
        }),
        this.prisma.transaction.count({
          where: {
            userId: input.userId,
            status: {
              in: [TransactionStatus.PENDING, TransactionStatus.DRAFT],
            },
          },
        }),
        this.prisma.transaction.count({
          where: {
            userId: input.userId,
            status: {
              in: [TransactionStatus.FAILED, TransactionStatus.EXPIRED],
            },
          },
        }),
        this.prisma.transaction.count({
          where: {
            userId: input.userId,
            status: {
              in: [TransactionStatus.REFUNDED, TransactionStatus.CHARGEBACK],
            },
          },
        }),
      ]);

    const [revTodayAgg, revWeekAgg, revMonthAgg, revPrevMonthAgg] =
      await this.prisma.$transaction([
        this.prisma.transaction.aggregate({
          where: { ...completedWhere, createdAt: { gte: todayStart } },
          _sum: { netAmount: true },
          _count: { _all: true },
        }),
        this.prisma.transaction.aggregate({
          where: { ...completedWhere, createdAt: { gte: weekStart } },
          _sum: { netAmount: true },
          _count: { _all: true },
        }),
        this.prisma.transaction.aggregate({
          where: { ...completedWhere, createdAt: { gte: monthStart } },
          _sum: { netAmount: true },
          _count: { _all: true },
        }),
        this.prisma.transaction.aggregate({
          where: {
            ...completedWhere,
            createdAt: { gte: prevMonthStart, lte: prevMonthEnd },
          },
          _sum: { netAmount: true },
          _count: { _all: true },
        }),
      ]);

    const todayValue = Number(revTodayAgg._sum.netAmount ?? 0);
    const weekValue = Number(revWeekAgg._sum.netAmount ?? 0);
    const monthValue = Number(revMonthAgg._sum.netAmount ?? 0);
    const prevMonthValue = Number(revPrevMonthAgg._sum.netAmount ?? 0);

    const variation =
      prevMonthValue > 0
        ? ((monthValue - prevMonthValue) / prevMonthValue) * 100
        : 0;

    const [withdrawPendingAgg, withdrawPaidAgg] =
      await this.prisma.$transaction([
        this.prisma.withdrawRequest.aggregate({
          where: { userId: input.userId, status: WithdrawStatus.PENDING },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        this.prisma.withdrawRequest.aggregate({
          where: { userId: input.userId, status: WithdrawStatus.COMPLETED },
          _sum: { amount: true },
        }),
      ]);

    const graphFrom = new Date(todayStart);
    graphFrom.setDate(todayStart.getDate() - 6);

    const graphAgg = await this.prisma.transaction.groupBy({
      by: ['createdAt'],
      where: {
        ...completedWhere,
        createdAt: { gte: graphFrom },
      },
      _sum: { netAmount: true },
      _count: { _all: true },
    });

    const bucket: Record<string, { valor: number; quantidade: number }> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(graphFrom);
      d.setDate(graphFrom.getDate() + i);
      const key = startOfDay(d).toISOString().slice(0, 10);
      bucket[key] = { valor: 0, quantidade: 0 };
    }

    for (const row of graphAgg) {
      const key = startOfDay(row.createdAt).toISOString().slice(0, 10);
      const item = bucket[key];
      if (!item) continue;
      item.valor += Number(row._sum.netAmount ?? 0);
      item.quantidade += row._count._all;
    }

    const grafico = Object.entries(bucket).map(([data, v]) => ({
      data,
      valor: v.valor,
      quantidade: v.quantidade,
    }));

    return {
      data: {
        receita: {
          hoje: todayValue,
          semana: weekValue,
          mes: monthValue,
          mesAnterior: prevMonthValue,
          variacao: variation,
        },
        transacoes: {
          total: txTotal,
          aprovadas: txApproved,
          pendentes: txPending,
          recusadas: txRejected,
          estornadas: txRefunded,
        },
        saques: {
          pendentes: withdrawPendingAgg._count._all,
          valorPendente: Number(withdrawPendingAgg._sum.amount ?? 0),
          totalPago: Number(withdrawPaidAgg._sum.amount ?? 0),
        },
        grafico,
      },
    };
  }
}
