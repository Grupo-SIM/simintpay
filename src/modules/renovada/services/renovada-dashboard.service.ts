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

  constructor(private readonly prisma: PrismaService) {}

  async getDashboardData(period: string = 'hoje') {
    const now = dayjs().tz(TZ);
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

    this.logger.log(`[Dashboard] Agora (BRT): ${now.format('DD/MM/YYYY HH:mm:ss')} | Início do período "${period}": ${dayjs(start).tz(TZ).format('DD/MM/YYYY HH:mm:ss')}`);

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

    const txsInPeriod = allTransactions.filter(tx => {
      const txDate = dayjs(tx.createdAt);
      return (txDate.isAfter(start) || txDate.isSame(start)) && (txDate.isBefore(end) || txDate.isSame(end));
    });
    const profitSelected = getProfit(txsInPeriod);
    const profitTotal = getProfit(allTransactions);

    this.logger.log(
      `[Dashboard] Período "${period}": ${txsInPeriod.length} txs | líquido total=${profitSelected.total.toFixed(2)} (online=${profitSelected.offers.toFixed(2)} físico=${profitSelected.maquinetas.toFixed(2)})`,
    );
    
    // 2. Dados da Wallet — mesmo cálculo da rota de saques (get-withdraw-summary):
    // wallet.balance é BRUTO; saldo líquido disponível = (balance - locked) * fatorLiquidez
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } });
    const balanceVal = Number(wallet?.balance || 0);
    const lockedVal = Number(wallet?.lockedBalance || 0);
    const fatorLiquidez = RenovadaConfig.saque.fatorLiquidez ?? 0.91;
    const availableBalanceNet = Number(((balanceVal - lockedVal) * fatorLiquidez).toFixed(3));

    this.logger.log(
      `[Dashboard] Saldo: bruto=${balanceVal.toFixed(2)} bloqueado=${lockedVal.toFixed(2)} fator=${fatorLiquidez} líquido=${availableBalanceNet}`,
    );

    // 3. Estornos (REFUNDED)
    const estornosAgg = await this.prisma.transaction.aggregate({
      where: { userId: RENOVADA_ID, status: TransactionStatus.REFUNDED },
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
      },
    };
  }

  private async getChartData(count: number, unit: 'day' | 'month') {
    const data: { label: string; value: number }[] = [];
    const now = dayjs().tz(TZ);

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

      const label = unit === 'day' ? d.format('DD/MM') : d.format('MMM');
      const value = Number(Number(result._sum.netAmount || 0).toFixed(2));

      this.logger.debug(`[Dashboard] Gráfico ${unit} ${label} (${start.toISOString()} → ${end.toISOString()}): líquido=${value}`);

      data.push({ label, value });
    }

    return data;
  }
}
