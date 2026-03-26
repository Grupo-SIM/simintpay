import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, WithdrawStatus } from '@prisma/client';
import dayjs from 'dayjs';
import 'dayjs/locale/pt-br';

dayjs.locale('pt-br');

const RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';

@Injectable()
export class RenovadaDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardData(period: string = 'hoje') {
    const now = dayjs();
    let start: Date;
    let end: Date = now.toDate();

    switch (period) {
      case 'ontem':
        start = now.subtract(1, 'day').startOf('day').toDate();
        end = now.subtract(1, 'day').endOf('day').toDate();
        break;
      case '7dias':
        start = now.subtract(7, 'day').startOf('day').toDate();
        break;
      case '15dias':
        start = now.subtract(15, 'day').startOf('day').toDate();
        break;
      case '30dias':
        start = now.subtract(30, 'day').startOf('day').toDate();
        break;
      case 'hoje':
      default:
        start = now.startOf('day').toDate();
        break;
    }

    const todayStart = now.startOf('day').toDate();
    const sevenDaysAgo = now.subtract(7, 'day').startOf('day').toDate();
    const fifteenDaysAgo = now.subtract(15, 'day').startOf('day').toDate();
    const thirtyDaysAgo = now.subtract(30, 'day').startOf('day').toDate();
    const yearStart = now.startOf('year').toDate();

    // 1. Todas as Transações (para cálculo de totais, se necessário, mas focando no período selecionado)
    const allTransactions = await this.prisma.transaction.findMany({
      where: {
        userId: RENOVADA_ID,
        status: TransactionStatus.COMPLETED,
      },
      select: {
        netAmount: true,
        description: true,
        createdAt: true,
      },
    });

    const getProfit = (txs: any[]) => {
      let total = 0;
      let maquinetas = 0;
      let offers = 0;
      txs.forEach((tx) => {
        const net = Number(tx.netAmount || 0);
        total += net;
        // Identifica maquinetas pelo padrão "Maquineta" ou "Terminal:"
        if (tx.description?.includes('Maquineta') || tx.description?.includes('Terminal:')) {
          maquinetas += net;
        } else {
          offers += net;
        }
      });
      const getPct = (val: number) => total > 0 ? (val / total) * 100 : 0;
      return { 
        total: Number(total.toFixed(2)), 
        maquinetas: Number(maquinetas.toFixed(2)), 
        offers: Number(offers.toFixed(2)), 
        maquinetasPct: getPct(maquinetas), 
        offersPct: getPct(offers) 
      };
    };

    const profitSelected = getProfit(allTransactions.filter(tx => {
      const txDate = dayjs(tx.createdAt);
      return (txDate.isAfter(start) || txDate.isSame(start)) && (txDate.isBefore(end) || txDate.isSame(end));
    }));
    const profitTotal = getProfit(allTransactions);
    
    // 2. Dados da Wallet (Saldo Disponível Real)
    // Para Renovada, o saldo no banco (wallet.balance) já é o lucro líquido (recebido - sacado)
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } });
    const balanceVal = Number(wallet?.balance || 0);
    const lockedVal = Number(wallet?.lockedBalance || 0);
    const availableBalanceNet = Number((balanceVal - lockedVal).toFixed(2));

    // 3. Quantidade de Saques
    const withdrawals = await this.prisma.withdrawRequest.findMany({
      where: { userId: RENOVADA_ID },
      select: { createdAt: true },
    });

    const countWD = (s: Date, e: Date = now.toDate()) => {
      const startD = dayjs(s);
      const endD = dayjs(e);
      return withdrawals.filter(w => {
        const wDate = dayjs(w.createdAt);
        return (wDate.isAfter(startD) || wDate.isSame(startD)) && (wDate.isBefore(endD) || wDate.isSame(endD));
      }).length;
    };

    // 4. Gráficos (lucro líquido diário e mensal)
    const last30Days = await this.getChartData(30, 'day');
    const annualByMonth = await this.getChartData(12, 'month');

    return {
      period,
      summary: {
        availableBalance: availableBalanceNet,
        balanceInProcessing: 0,
      },
      selected: {
        profit: profitSelected,
        withdrawals: countWD(start, end),
      },
      profit: {
        total: Number(profitTotal.total.toFixed(2)),
        maquinetas: Number(profitTotal.maquinetas.toFixed(2)),
        offers: Number(profitTotal.offers.toFixed(2)),
        today: getProfit(allTransactions.filter(tx => dayjs(tx.createdAt).isAfter(dayjs(todayStart)) || dayjs(tx.createdAt).isSame(dayjs(todayStart)))),
        sevenDays: getProfit(allTransactions.filter(tx => dayjs(tx.createdAt).isAfter(dayjs(sevenDaysAgo)) || dayjs(tx.createdAt).isSame(dayjs(sevenDaysAgo)))),
        fifteenDays: getProfit(allTransactions.filter(tx => dayjs(tx.createdAt).isAfter(dayjs(fifteenDaysAgo)) || dayjs(tx.createdAt).isSame(dayjs(fifteenDaysAgo)))),
        thirtyDays: getProfit(allTransactions.filter(tx => dayjs(tx.createdAt).isAfter(dayjs(thirtyDaysAgo)) || dayjs(tx.createdAt).isSame(dayjs(thirtyDaysAgo)))),
        annual: getProfit(allTransactions.filter(tx => dayjs(tx.createdAt).isAfter(dayjs(yearStart)) || dayjs(tx.createdAt).isSame(dayjs(yearStart)))),
        charts: {
          last30Days,
          annualByMonth,
        }
      },
      withdrawals: {
        today: countWD(todayStart),
        sevenDays: countWD(sevenDaysAgo),
        fifteenDays: countWD(fifteenDaysAgo),
        thirtyDays: countWD(thirtyDaysAgo),
        annual: countWD(yearStart),
      },
    };
  }

  private async getChartData(count: number, unit: 'day' | 'month') {
    const data: { label: string; value: number }[] = [];
    const now = dayjs();

    for (let i = count - 1; i >= 0; i--) {
      const d = now.subtract(i, unit);
      const start = d.startOf(unit).toDate();
      const end = d.endOf(unit).toDate();

      const result = await this.prisma.transaction.aggregate({
        where: {
          userId: RENOVADA_ID,
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: start, lte: end },
        },
        _sum: {
          netAmount: true,
        },
      });

      data.push({
        label: unit === 'day' ? d.format('DD/MM') : d.format('MMM'),
        value: Number(Number(result._sum.netAmount || 0).toFixed(2)),
      });
    }

    return data;
  }
}
