import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { Prisma, TransactionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/pt-br';
import type { PlatformDashboardRules } from './platform-dashboard.adapter';
import { whereTransactionPlatform } from './transaction-platform';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('pt-br');

const TZ = 'America/Sao_Paulo';

export class PlatformDashboardReports {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: PlatformDashboardRules,
    private readonly expectedOwnerUserId?: string,
  ) {}

  private pagination(page: number, limit: number) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200
    )
      throw new BadRequestException('Paginação inválida');
  }

  private async ownerId(): Promise<string | null> {
    const platform = await this.prisma.platform.findFirst({
      where: {
        tag: this.rules.tag,
        isActive: true,
        owner: { isActive: true, isPurged: false },
      },
    });
    if (
      platform &&
      this.expectedOwnerUserId &&
      platform.ownerUserId !== this.expectedOwnerUserId
    )
      throw new ConflictException('Dono da plataforma mudou');
    return platform?.ownerUserId ?? null;
  }

  async getDashboardData(_period: string = 'hoje') {
    void _period;
    const userId = await this.ownerId();
    if (!userId) {
      return {
        error: `Usuário ${this.rules.name} não configurado. Cadastre plataforma e dono pelo admin`,
        profit: {
          total: 0,
          today: { total: 0 },
          sevenDays: { total: 0 },
          fifteenDays: { total: 0 },
          thirtyDays: { total: 0 },
          charts: { last30Days: [], annualByMonth: [] },
        },
        withdrawals: {
          today: 0,
          sevenDays: 0,
          fifteenDays: 0,
          thirtyDays: 0,
          annual: 0,
        },
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

    const allTransactions = await this.prisma.transaction.findMany({
      where: {
        ...whereTransactionPlatform(this.rules.tag),
        userId,
        status: TransactionStatus.COMPLETED,
      },
      select: { netAmount: true, createdAt: true },
    });

    const getProfit = (txs: any[]) => ({
      total: txs
        .reduce((sum, tx) => sum.plus(tx.netAmount ?? 0), new Prisma.Decimal(0))
        .toDecimalPlaces(2)
        .toNumber(),
    });

    const filterByDate = (from: Date, to: Date = now.toDate()) => {
      const fromD = dayjs(from);
      const toD = dayjs(to);
      return allTransactions.filter((tx) => {
        const d = dayjs(tx.createdAt);
        return (
          (d.isAfter(fromD) || d.isSame(fromD)) &&
          (d.isBefore(toD) || d.isSame(toD))
        );
      });
    };

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    const balanceVal = Number(wallet?.balance || 0);
    const lockedVal = Number(wallet?.lockedBalance || 0);
    const fatorLiquidez = this.rules.liquidity();
    const availableBalanceNet = Number(
      ((balanceVal - lockedVal) * fatorLiquidez).toFixed(2),
    );

    const estornosAgg = await this.prisma.transaction.aggregate({
      where: {
        ...whereTransactionPlatform(this.rules.tag),
        userId,
        status: TransactionStatus.REFUNDED,
      },
      _count: { id: true },
      _sum: { netAmount: true },
    });

    const withdrawals = await this.prisma.withdrawRequest.findMany({
      where: { platform: this.rules.tag.toLowerCase(), userId },
      select: { createdAt: true },
    });

    const countWD = (s: Date, e: Date = now.toDate()) => {
      const fromD = dayjs(s);
      const toD = dayjs(e);
      return withdrawals.filter((w) => {
        const d = dayjs(w.createdAt);
        return (
          (d.isAfter(fromD) || d.isSame(fromD)) &&
          (d.isBefore(toD) || d.isSame(toD))
        );
      }).length;
    };

    const last30Days = await this.getChartData(userId, 30, 'day');
    const annualByMonth = await this.getChartData(userId, 12, 'month');

    return {
      summary: {
        availableBalance: availableBalanceNet,
        balanceInProcessing: 0,
      },
      profit: {
        total: getProfit(allTransactions).total,
        today: getProfit(filterByDate(todayStart)),
        sevenDays: getProfit(filterByDate(sevenDaysAgo)),
        fifteenDays: getProfit(filterByDate(fifteenDaysAgo)),
        thirtyDays: getProfit(filterByDate(thirtyDaysAgo)),
        charts: { last30Days, annualByMonth },
      },
      estornos: {
        quantidade: estornosAgg._count.id,
        valorLiquido: Number(
          Number(estornosAgg._sum.netAmount || 0).toFixed(2),
        ),
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
    this.pagination(page, limit);
    const userId = await this.ownerId();
    if (!userId)
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };

    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { ...whereTransactionPlatform(this.rules.tag), userId },
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
      this.prisma.transaction.count({
        where: { ...whereTransactionPlatform(this.rules.tag), userId },
      }),
    ]);

    return {
      data: transactions.map((tx) => ({
        id: tx.id,
        status: tx.status,
        name: tx.customerName ?? '—',
        description: tx.description ?? '—',
        createdAt: tx.createdAt,
        valor_transacao_cheia: Number(tx.amount),
        valor_liquido: this.rules.salesNet(Number(tx.netAmount ?? 0)),
        paymentMethod: tx.paymentMethod,
        installments: tx.installments,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getWithdrawals(page: number, limit: number) {
    this.pagination(page, limit);
    const userId = await this.ownerId();
    if (!userId)
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };

    const skip = (page - 1) * limit;
    const [withdrawals, total] = await Promise.all([
      this.prisma.withdrawRequest.findMany({
        where: { platform: this.rules.tag.toLowerCase(), userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.withdrawRequest.count({
        where: { platform: this.rules.tag.toLowerCase(), userId },
      }),
    ]);

    return {
      data: withdrawals.map((w) => ({
        id: w.id,
        amount: Number(w.amount),
        grossAmount: Number(w.grossAmount),
        fee: Number(w.fee ?? 0),
        pixKey: w.pixKey,
        status: w.status,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getSummary() {
    const userId = await this.ownerId();
    if (!userId) return { total_balance: 0, total_vendas: 0, total_sacado: 0 };

    const [vendas, saques, wallet] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          ...whereTransactionPlatform(this.rules.tag),
          userId,
          status: TransactionStatus.COMPLETED,
        },
        _sum: { netAmount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: {
          platform: this.rules.tag.toLowerCase(),
          userId,
          status: { in: ['COMPLETED', 'APPROVED'] as any },
        },
        _sum: { amount: true },
      }),
      this.prisma.wallet.findUnique({ where: { userId } }),
    ]);

    const totalVendas = Number(vendas._sum.netAmount ?? 0);
    const totalSacado = Number(saques._sum.amount ?? 0);
    const fator = this.rules.liquidity();
    const balanceVal = Number(wallet?.balance ?? 0);
    const lockedVal = Number(wallet?.lockedBalance ?? 0);
    const saldoAtual = Number(((balanceVal - lockedVal) * fator).toFixed(2));

    return {
      total_balance: saldoAtual,
      total_vendas: Number(totalVendas.toFixed(2)),
      total_sacado: Number(totalSacado.toFixed(2)),
    };
  }

  private async getChartData(
    userId: string,
    count: number,
    unit: 'day' | 'month',
  ) {
    const data: { label: string; value: number }[] = [];
    const now = dayjs().tz(TZ);

    for (let i = count - 1; i >= 0; i--) {
      const d = now.subtract(i, unit);
      const start = d.startOf(unit).toDate();
      const end = d.endOf(unit).toDate();

      const agg = await this.prisma.transaction.aggregate({
        where: {
          ...whereTransactionPlatform(this.rules.tag),
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
