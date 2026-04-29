import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/pt-br';
import { RevalidaConfig } from '../revalida.config';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('pt-br');

const TZ = 'America/Sao_Paulo';

@Injectable()
export class RevalidaDashboardService {
  private readonly logger = new Logger(RevalidaDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getRevalidaUserId(): Promise<string | null> {
    const envId = process.env.REVALIDA_USER_ID;
    if (envId) return envId;

    const user = await this.prisma.user.findFirst({
      where: { email: 'revalida@jbmidia.com.br' },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async getDashboardData(period: string = 'hoje') {
    const userId = await this.getRevalidaUserId();
    if (!userId) {
      return {
        error: 'Usuário Revalida não configurado. Execute POST /admin/revalida/setup',
        profit: { total: 0, today: { total: 0 }, sevenDays: { total: 0 }, fifteenDays: { total: 0 }, thirtyDays: { total: 0 }, charts: { last30Days: [], annualByMonth: [] } },
        withdrawals: { today: 0, sevenDays: 0, fifteenDays: 0, thirtyDays: 0, annual: 0 },
        estornos: { quantidade: 0, valorLiquido: 0 },
        summary: { availableBalance: 0, balanceInProcessing: 0 },
      };
    }

    const now = dayjs().tz(TZ);

    const todayStart = now.startOf('day').toDate();
    const sevenDaysAgo = now.subtract(7, 'day').startOf('day').toDate();
    const fifteenDaysAgo = now.subtract(15, 'day').startOf('day').toDate();
    const thirtyDaysAgo = now.subtract(30, 'day').startOf('day').toDate();
    const yearStart = now.startOf('year').toDate();

    // Todas as transações COMPLETED (lucro líquido = netAmount)
    const allTransactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        status: TransactionStatus.COMPLETED,
      },
      select: {
        netAmount: true,
        createdAt: true,
      },
    });

    const getProfit = (txs: any[]) => {
      const total = txs.reduce((sum, tx) => sum + Number(tx.netAmount || 0), 0);
      return { total: Number(total.toFixed(2)) };
    };

    const filterByDate = (from: Date, to: Date = now.toDate()) => {
      const fromD = dayjs(from);
      const toD = dayjs(to);
      return allTransactions.filter(tx => {
        const d = dayjs(tx.createdAt);
        return (d.isAfter(fromD) || d.isSame(fromD)) && (d.isBefore(toD) || d.isSame(toD));
      });
    };

    const profitTotal = getProfit(allTransactions);
    const profitToday = getProfit(filterByDate(todayStart));
    const profitSevenDays = getProfit(filterByDate(sevenDaysAgo));
    const profitFifteenDays = getProfit(filterByDate(fifteenDaysAgo));
    const profitThirtyDays = getProfit(filterByDate(thirtyDaysAgo));

    // Wallet
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    const balanceVal = Number(wallet?.balance || 0);
    const lockedVal = Number(wallet?.lockedBalance || 0);
    const fatorLiquidez = RevalidaConfig.saque.fatorLiquidez ?? 0.91;
    const availableBalanceNet = Number(((balanceVal - lockedVal) * fatorLiquidez).toFixed(2));

    // Estornos
    const estornosAgg = await this.prisma.transaction.aggregate({
      where: { userId, status: TransactionStatus.REFUNDED },
      _count: { id: true },
      _sum: { netAmount: true },
    });

    // Saques
    const withdrawals = await this.prisma.withdrawRequest.findMany({
      where: { userId },
      select: { createdAt: true },
    });

    const countWD = (s: Date, e: Date = now.toDate()) => {
      const fromD = dayjs(s);
      const toD = dayjs(e);
      return withdrawals.filter(w => {
        const d = dayjs(w.createdAt);
        return (d.isAfter(fromD) || d.isSame(fromD)) && (d.isBefore(toD) || d.isSame(toD));
      }).length;
    };

    // Gráficos
    const last30Days = await this.getChartData(userId, 30, 'day');
    const annualByMonth = await this.getChartData(userId, 12, 'month');

    return {
      summary: {
        availableBalance: availableBalanceNet,
        balanceInProcessing: 0,
      },
      profit: {
        total: profitTotal.total,
        today: profitToday,
        sevenDays: profitSevenDays,
        fifteenDays: profitFifteenDays,
        thirtyDays: profitThirtyDays,
        charts: {
          last30Days,
          annualByMonth,
        },
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

  async getSales(page: number, limit: number) {
    const userId = await this.getRevalidaUserId();
    if (!userId) return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };

    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          status: true,
          amount: true,
          netAmount: true,
          paymentMethod: true,
          installments: true,
          customerName: true,
          customerEmail: true,
          createdAt: true,
          description: true,
        },
      }),
      this.prisma.transaction.count({ where: { userId } }),
    ]);

    const taxaFixa = getPlatformTaxaEffective('REVALIDA', 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
    const taxaCashback = getPlatformTaxaEffective('REVALIDA', 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
    const taxaServico = taxaFixa + taxaCashback;

    return {
      data: transactions.map(tx => ({
        id: tx.id,
        status: tx.status,
        name: tx.customerName ?? '—',
        description: tx.description ?? '—',
        createdAt: tx.createdAt,
        valor_transacao_cheia: Number(tx.amount),
        valor_liquido: Number((Number(tx.netAmount ?? 0) - taxaServico).toFixed(2)),
        paymentMethod: tx.paymentMethod,
        installments: tx.installments,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getWithdrawals(page: number, limit: number) {
    const userId = await this.getRevalidaUserId();
    if (!userId) return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };

    const skip = (page - 1) * limit;
    const [withdrawals, total] = await Promise.all([
      this.prisma.withdrawRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.withdrawRequest.count({ where: { userId } }),
    ]);

    return {
      data: withdrawals.map(w => ({
        id: w.id,
        amount: Number(w.amount),
        grossAmount: Number(w.grossAmount),
        fee: Number(w.fee ?? 0),
        pixKey: w.pixKey,
        status: w.status,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSummary() {
    const userId = await this.getRevalidaUserId();
    if (!userId) return { total_balance: 0, total_vendas: 0, total_sacado: 0 };

    const [vendas, saques, wallet] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { userId, status: TransactionStatus.COMPLETED },
        _sum: { netAmount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { userId, status: { in: ['COMPLETED', 'APPROVED'] as any } },
        _sum: { amount: true },
      }),
      this.prisma.wallet.findUnique({ where: { userId } }),
    ]);

    const totalVendas = Number(vendas._sum.netAmount ?? 0);
    const totalSacado = Number(saques._sum.amount ?? 0);
    const fator = RevalidaConfig.saque.fatorLiquidez ?? 0.91;
    const balanceVal = Number(wallet?.balance ?? 0);
    const lockedVal = Number(wallet?.lockedBalance ?? 0);
    const saldoAtual = Number(((balanceVal - lockedVal) * fator).toFixed(2));

    return {
      total_balance: saldoAtual,
      total_vendas: Number(totalVendas.toFixed(2)),
      total_sacado: Number(totalSacado.toFixed(2)),
    };
  }

  private async getChartData(userId: string, count: number, unit: 'day' | 'month') {
    const data: { label: string; value: number }[] = [];
    const now = dayjs().tz(TZ);

    for (let i = count - 1; i >= 0; i--) {
      const d = now.subtract(i, unit);
      const start = d.startOf(unit).toDate();
      const end = d.endOf(unit).toDate();

      const agg = await this.prisma.transaction.aggregate({
        where: {
          userId,
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: start, lte: end },
        },
        _sum: { netAmount: true },
      });

      const label = unit === 'day' ? d.format('DD/MM') : d.format('MMM');
      const value = Number(Number(agg._sum.netAmount ?? 0).toFixed(2));
      data.push({ label, value });
    }

    return data;
  }
}
