import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, WithdrawStatus } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/pt-br';
import { RenovadaConfig } from '../renovada.config';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('pt-br');

const TZ = 'America/Sao_Paulo';

const RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';

@Injectable()
export class RenovadaDashboardService {
  private readonly logger = new Logger(RenovadaDashboardService.name);

  constructor(private readonly prisma: PrismaService) { }

  async getDashboardData(period: string = 'hoje', dataInicio?: string, dataFim?: string) {
    const now = dayjs().tz(TZ);
    let start: Date;
    let end: Date = now.toDate();

    if (dataInicio || dataFim) {
      start = dataInicio ? dayjs(dataInicio).startOf('day').toDate() : now.subtract(10, 'year').toDate();
      end = dataFim ? dayjs(dataFim).endOf('day').toDate() : now.toDate();
    } else {
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
    }

    const todayStart = now.startOf('day').toDate();
    const sevenDaysAgo = now.subtract(7, 'day').startOf('day').toDate();
    const fifteenDaysAgo = now.subtract(15, 'day').startOf('day').toDate();
    const thirtyDaysAgo = now.subtract(30, 'day').startOf('day').toDate();
    const yearStart = now.startOf('year').toDate();

    this.logger.log(`[Dashboard] Agora (BRT): ${now.format('DD/MM/YYYY HH:mm:ss')} | Início do período "${period}": ${dayjs(start).tz(TZ).format('DD/MM/YYYY HH:mm:ss')}`);

    // 1. Transactions filtered by description keywords (same as AdminController)
    const renovadaKeywords = ['dizimo', 'dízimo', 'primicia', 'primícia', 'oferta', 'maquineta', 'terminal'];
    const descriptionFilter = {
      OR: renovadaKeywords.map(k => ({ description: { contains: k, mode: 'insensitive' } }))
    };

    const allTransactions = await this.prisma.transaction.findMany({
      where: {
        userId: RENOVADA_ID,
        status: TransactionStatus.COMPLETED,
        ...descriptionFilter as any
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
        const desc = (tx.description || '').toLowerCase();
        if (desc.includes('maquineta') || desc.includes('terminal')) {
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

    const txsInPeriod = allTransactions.filter(tx => {
      const txDate = dayjs(tx.createdAt);
      return (txDate.isAfter(start) || txDate.isSame(start)) && (txDate.isBefore(end) || txDate.isSame(end));
    });

    const profitSelected = getProfit(txsInPeriod);
    const profitTotal = getProfit(allTransactions);

    this.logger.log(
      `[Dashboard] Período "${period}": ${txsInPeriod.length} txs | líquido total=${profitSelected.total.toFixed(2)}`,
    );

    // 2. Dados da Wallet
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } });
    const balanceVal = Number(wallet?.balance || 0);
    const lockedVal = Number(wallet?.lockedBalance || 0);
    const fatorLiquidez = RenovadaConfig.saque.fatorLiquidez ?? 0.91;
    const availableBalanceNet = Number(((balanceVal - lockedVal) * fatorLiquidez).toFixed(3));

    // 3. Estornos (REFUNDED)
    const estornosAgg = await this.prisma.transaction.aggregate({
      where: { 
        userId: RENOVADA_ID, 
        status: TransactionStatus.REFUNDED,
        createdAt: { gte: start, lte: end },
        ...descriptionFilter as any
      },
      _count: { id: true },
      _sum: { netAmount: true },
    });

    // 4. Quantidade de Saques
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

    const last30Days = await this.getChartData(30, 'day');
    const annualByMonth = await this.getChartData(12, 'month');

    // Determine metrics based on whether filters are active
    const isFiltered = !!(dataInicio || dataFim);
    const mainProfit = isFiltered ? profitSelected : profitTotal;

    return {
      period,
      isFiltered,
      summary: {
        availableBalance: availableBalanceNet,
        balanceInProcessing: 0,
      },
      selected: {
        profit: profitSelected,
        withdrawals: countWD(start, end),
      },
      profit: {
        total: Number(mainProfit.total.toFixed(2)),
        maquinetas: Number(mainProfit.maquinetas.toFixed(2)),
        offers: Number(mainProfit.offers.toFixed(2)),
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
      estornos: {
        quantidade: estornosAgg._count.id,
        valorLiquido: Number(Number(estornosAgg._sum.netAmount || 0).toFixed(2)),
      },
      withdrawals: {
        today: countWD(todayStart),
        sevenDays: countWD(sevenDaysAgo),
        fifteenDays: countWD(fifteenDaysAgo),
        thirtyDays: countWD(thirtyDaysAgo),
        annual: countWD(yearStart),
        selected: countWD(start, end),
      },
    };
  }

  private async getChartData(count: number, unit: 'day' | 'month') {
    const data: { label: string; value: number; maquinetas: number; offers: number }[] = [];
    const now = dayjs().tz(TZ);

    for (let i = count - 1; i >= 0; i--) {
      const d = now.subtract(i, unit);
      const start = d.startOf(unit).toDate();
      const end = d.endOf(unit).toDate();

      const txs = await this.prisma.transaction.findMany({
        where: {
          userId: RENOVADA_ID,
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: start, lte: end },
        },
        select: { netAmount: true, description: true },
      });

      let maquinetas = 0;
      let offers = 0;
      for (const tx of txs) {
        const net = Number(tx.netAmount || 0);
        if (tx.description?.includes('Maquineta') || tx.description?.includes('Terminal:')) {
          maquinetas += net;
        } else {
          offers += net;
        }
      }

      const label = unit === 'day' ? d.format('DD/MM') : d.format('MMM');
      const value = Number((maquinetas + offers).toFixed(2));

      this.logger.debug(`[Dashboard] Gráfico ${unit} ${label} (${start.toISOString()} → ${end.toISOString()}): líquido=${value}`);

      data.push({ label, value, maquinetas: Number(maquinetas.toFixed(2)), offers: Number(offers.toFixed(2)) });
    }

    return data;
  }
}
