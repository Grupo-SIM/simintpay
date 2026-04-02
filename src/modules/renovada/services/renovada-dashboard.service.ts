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

const PLATFORM_IDS: Record<string, string> = {
  RENOVADA: 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  PAGATG: 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5d',
  BOSQUE: 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c',
  REVALIDA: '7929df01-a980-45e3-b3c7-1a8b8eb7850f',
};

@Injectable()
export class PlatformDashboardService {
  private readonly logger = new Logger(PlatformDashboardService.name);

  constructor(private readonly prisma: PrismaService) { }

  async getDashboardData(tag: string, period: string = 'hoje', dataInicio?: string, dataFim?: string) {
    const upperTag = (tag || 'renovada').toUpperCase();
    const now = dayjs().tz(TZ);
    let start: Date;
    let end: Date = now.toDate();

    // Para EBOOK/PAGATG: usa filtro por tag na descrição (multi-vendor), não por userId único
    const isEbook = upperTag === 'EBOOK';
    const isPagatg = upperTag === 'PAGATG';
    const isAtlas = upperTag === 'ATLAS';
    const isTenantTagged = isEbook || isPagatg;

    // Carteira/saques Atlas: conta técnica (não usar fallback Renovada no userId)
    let atlasWalletUserId: string | null = null;
    if (isAtlas) {
      const envAtlas = process.env.ATLAS_USER_ID?.trim();
      if (envAtlas) atlasWalletUserId = envAtlas;
      else {
        const u = await this.prisma.user.findFirst({
          where: { email: 'atlas@jbmidia.com.br' },
          select: { id: true },
        });
        atlasWalletUserId = u?.id ?? null;
      }
    }

    // Prioridade: .env -> Mapa Interno -> ID da Renovada (Legacy Fallback) — não usado para tenant-tagged
    const platIdKey = `${upperTag}_ID`;
    const platformId = isTenantTagged
      ? null
      : (process.env[platIdKey] || PLATFORM_IDS[upperTag] || PLATFORM_IDS.RENOVADA);

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

    this.logger.log(`[Dashboard] Tag: ${upperTag} | Período "${period}": ${dayjs(start).tz(TZ).format('DD/MM/YYYY HH:mm:ss')}`);

    // Atlas (/plataformas/atlas): lucro/estornos/gráficos por descrição com "atlas" (qualquer userId)
    let filter: any = isAtlas
      ? {
          status: TransactionStatus.COMPLETED,
          description: { contains: 'atlas', mode: 'insensitive' as const },
        }
      : isTenantTagged
      ? {
          status: TransactionStatus.COMPLETED,
          description: { contains: `[TENANT:${upperTag}]`, mode: 'insensitive' as const },
        }
      : { userId: platformId, status: TransactionStatus.COMPLETED };

    if (upperTag === 'RENOVADA') {
      const keywords = ['dizimo', 'dízimo', 'primicia', 'primícia', 'oferta', 'maquineta', 'terminal'];
      filter.OR = keywords.map(k => ({ description: { contains: k, mode: 'insensitive' } }));
    }

    const allTransactions = await this.prisma.transaction.findMany({
      where: filter,
      select: {
        amount: true,
        netAmount: true,
        description: true,
        createdAt: true,
      },
    });

    // Resolve liquidity and fees based on platform tag
    const liquidityKey = `${upperTag}_LIQUIDEZ`;
    const fixedFeeKey = `${upperTag}_TAXA_FIXA_TRANSACAO`;
    const cashbackKey = `${upperTag}_TAXA_CASHBACK`;

    const liquidityFactor = Number(process.env[liquidityKey] || process.env.DEFAULT_LIQUIDITY_FACTOR || 0.91);
    const fixedFee = Number(process.env[fixedFeeKey] || 0);
    const cashbackFee = Number(process.env[cashbackKey] || 0);
    const adminMargin = 1 - liquidityFactor;

    const getProfit = (txs: any[]) => {
      let total = 0;
      let maquinetas = 0;
      let offers = 0;
      let lucroSimpay = 0;

      txs.forEach((tx) => {
        const net = Number(tx.netAmount || 0);
        const bruto = Number(tx.amount || (net / liquidityFactor));
        
        total += net;
        lucroSimpay += Number(((bruto * adminMargin) - fixedFee - cashbackFee).toFixed(2));

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
        lucroSimpay: Number(lucroSimpay.toFixed(2)),
        maquinetasPct: getPct(maquinetas),
        offersPct: getPct(offers)
      };
    };

    const txsInPeriod = allTransactions.filter(tx => {
      const d = dayjs(tx.createdAt);
      return (d.isAfter(start) || d.isSame(start)) && (d.isBefore(end) || d.isSame(end));
    });

    const profitSelected = getProfit(txsInPeriod);
    const profitTotal = getProfit(allTransactions);

    // 2. Dados da Wallet — EBOOK/PAGATG multi-vendor; Atlas usa conta técnica; Renovada usa lógica especial
    const wallet =
      isTenantTagged
        ? null
        : isAtlas
        ? atlasWalletUserId
          ? await this.prisma.wallet.findUnique({ where: { userId: atlasWalletUserId } })
          : null
        : await this.prisma.wallet.findUnique({ where: { userId: platformId! } });
    const balanceVal = Number(wallet?.balance || 0);
    const lockedVal = Number(wallet?.lockedBalance || 0);

    let availableBalanceNet: number;
    if (isTenantTagged) {
      availableBalanceNet = 0; // multi-vendor: each author has their own wallet
    } else if (isAtlas) {
      availableBalanceNet = atlasWalletUserId
        ? Number(((balanceVal - lockedVal) * liquidityFactor).toFixed(3))
        : 0;
    } else if (upperTag === 'RENOVADA') {
      const debitedAggr = await this.prisma.withdrawRequest.aggregate({
        where: {
          userId: platformId!,
          status: { in: [WithdrawStatus.APPROVED, WithdrawStatus.COMPLETED] },
        },
        _sum: { grossAmount: true },
      });
      const debitedBruto = Number(debitedAggr._sum.grossAmount || 0);
      const pendingAggr = await this.prisma.withdrawRequest.aggregate({
        where: { userId: platformId!, status: WithdrawStatus.PENDING },
        _sum: { grossAmount: true },
      });
      const pendingBruto = Number(pendingAggr._sum.grossAmount || 0);
      const rawTotalNet =
        balanceVal * liquidityFactor + debitedBruto * (liquidityFactor - 1);
      const displayTotalNet = Math.max(0, rawTotalNet);
      availableBalanceNet = Number(Math.max(0, displayTotalNet - pendingBruto).toFixed(2));
    } else {
      availableBalanceNet = Number(((balanceVal - lockedVal) * liquidityFactor).toFixed(3));
    }

    // 3. Estornos
    const estornosWhere: any = isAtlas
      ? {
          status: TransactionStatus.REFUNDED,
          createdAt: { gte: start, lte: end },
          description: { contains: 'atlas', mode: 'insensitive' as const },
        }
      : isTenantTagged
      ? {
          status: TransactionStatus.REFUNDED,
          createdAt: { gte: start, lte: end },
          description: { contains: `[TENANT:${upperTag}]`, mode: 'insensitive' as const },
        }
      : {
          userId: platformId,
          status: TransactionStatus.REFUNDED,
          createdAt: { gte: start, lte: end },
          ...(filter.OR ? { OR: filter.OR } : {}),
        };
    const estornosAgg = await this.prisma.transaction.aggregate({
      where: estornosWhere,
      _count: { id: true },
      _sum: { netAmount: true },
    });

    // 4. Saques — EBOOK/PAGATG não têm saques centralizados (cada autor saca da própria conta)
    const withdrawals = isTenantTagged
      ? []
      : isAtlas
      ? atlasWalletUserId
        ? await this.prisma.withdrawRequest.findMany({
            where: { userId: atlasWalletUserId },
            select: { createdAt: true },
          })
        : []
      : await this.prisma.withdrawRequest.findMany({
          where: { userId: platformId! },
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

    const chartPlatformId = isTenantTagged || isAtlas ? null : platformId;
    const chartTenant = isTenantTagged ? upperTag : null;
    const chartDescContains = isAtlas ? 'atlas' : null;
    const last30Days = await this.getChartData(chartPlatformId, 30, 'day', liquidityFactor, chartTenant, chartDescContains);
    const annualByMonth = await this.getChartData(chartPlatformId, 12, 'month', liquidityFactor, chartTenant, chartDescContains);

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
        lucroSimpay: Number(mainProfit.lucroSimpay.toFixed(2)),
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

  private async getChartData(
    platformId: string | null,
    count: number,
    unit: 'day' | 'month',
    liquidityFactor: number,
    tenantTag: string | null = null,
    descriptionContains: string | null = null,
  ) {
    const data: { label: string; value: number; maquinetas: number; offers: number }[] = [];
    const now = dayjs().tz(TZ);

    for (let i = count - 1; i >= 0; i--) {
      const d = now.subtract(i, unit);
      const start = d.startOf(unit).toDate();
      const end = d.endOf(unit).toDate();

      const renovadaKeywords = ['dizimo', 'dízimo', 'primicia', 'primícia', 'oferta', 'maquineta', 'terminal'];
      const chartWhere: any = descriptionContains
        ? {
            status: TransactionStatus.COMPLETED,
            createdAt: { gte: start, lte: end },
            description: { contains: descriptionContains, mode: 'insensitive' as const },
          }
        : tenantTag
        ? {
            status: TransactionStatus.COMPLETED,
            createdAt: { gte: start, lte: end },
            description: { contains: `[TENANT:${tenantTag}]`, mode: 'insensitive' as const },
          }
        : {
            userId: platformId,
            status: TransactionStatus.COMPLETED,
            createdAt: { gte: start, lte: end },
            OR: renovadaKeywords.map(k => ({ description: { contains: k, mode: 'insensitive' as const } })),
          };
      const txs = await this.prisma.transaction.findMany({
        where: chartWhere,
        select: { netAmount: true, description: true },
      });

      let maquinetas = 0;
      let offers = 0;
      for (const tx of txs) {
        const net = Number(tx.netAmount || 0);
        if (tx.description?.toLowerCase().includes('maquineta') || tx.description?.toLowerCase().includes('terminal')) {
          maquinetas += net;
        } else {
          offers += net;
        }
      }

      const label = unit === 'day' ? d.format('DD/MM') : d.format('MMM');
      const value = Number((maquinetas + offers).toFixed(2));

      data.push({ label, value, maquinetas: Number(maquinetas.toFixed(2)), offers: Number(offers.toFixed(2)) });
    }

    return data;
  }
}
