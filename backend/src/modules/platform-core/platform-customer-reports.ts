import { getPlatformOwnerId } from '../module.registry';
import { getPlatformTaxaEffective } from '../platform-taxas/platform-taxas.store';
import { ConflictException } from '@nestjs/common';
import type { PlatformContext } from './platform-context.service';
import { hasPlatformMarker } from './platform-sync.adapter';
import { platformDashboardRules } from './platform-dashboard.adapter';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { Prisma, TransactionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/pt-br';
import { coproductionTotals } from '../coproduction/coproduction-view';
import { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('pt-br');

const TZ = 'America/Sao_Paulo';

export class PlatformCustomerReports {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context?: PlatformContext,
  ) {}

  async getDashboardData(
    period: string = 'hoje',
    jwtUser: Pick<JwtPayload, 'sub'>,
  ) {
    if (this.context) {
      const current = await this.prisma.platform.findUnique({
        where: { id: this.context.id },
        include: { owner: true },
      });
      if (
        !current?.isActive ||
        !current.owner.isActive ||
        current.owner.isPurged ||
        current.ownerUserId !== this.context.ownerUserId ||
        current.tag !== this.context.tag ||
        jwtUser.sub !== current.ownerUserId
      )
        throw new ConflictException('Contexto da plataforma mudou');
    }
    const dbUser = await this.prisma.user.findUnique({
      where: { id: jwtUser.sub },
    });
    if (!dbUser) throw new Error('Usuário não encontrado');

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
    const thirtyDaysAgo = now.subtract(30, 'day').startOf('day').toDate();
    const yearStart = now.startOf('year').toDate();

    // IDs dos pools onde as transações podem estar (PagaTG, Renovada, etc.)
    const poolIds = this.context
      ? [this.context.ownerUserId]
      : ([
          getPlatformOwnerId('PAGATG'),
          getPlatformOwnerId('RENOVADA'),
          process.env.ADMIN_USER_ID,
        ].filter(Boolean) as string[]);

    // 1. Transações filtradas por CPF na descrição (Clientes Avulsos)
    // Buscamos em todos os possíveis "pools" de transações do sistema
    const candidates = await this.prisma.transaction.findMany({
      where: {
        userId: { in: poolIds },
        status: TransactionStatus.COMPLETED,
        description: {
          contains: this.context
            ? `[TENANT:${this.context.tag}]`
            : dbUser.cpf || 'UNDEFINED_CPF',
          mode: 'insensitive' as const,
        },
      },
      select: { netAmount: true, description: true, createdAt: true },
    });

    const allTransactions = this.context
      ? candidates.filter((tx) =>
          hasPlatformMarker(tx.description, this.context!.tag),
        )
      : candidates;

    const getProfit = (txs: any[]) => {
      let total = new Prisma.Decimal(0);
      let maquinetas = new Prisma.Decimal(0);
      let offers = new Prisma.Decimal(0);
      txs.forEach((tx) => {
        const net = new Prisma.Decimal(tx.netAmount || 0);
        total = total.plus(net);
        if (
          tx.description?.includes('Maquineta') ||
          tx.description?.includes('Terminal:')
        ) {
          maquinetas = maquinetas.plus(net);
        } else {
          offers = offers.plus(net);
        }
      });
      return {
        total: Number(total.toFixed(2)),
        maquinetas: Number(maquinetas.toFixed(2)),
        offers: Number(offers.toFixed(2)),
      };
    };

    const txsInPeriod = allTransactions.filter((tx) => {
      const txDate = dayjs(tx.createdAt);
      return (
        (txDate.isAfter(start) || txDate.isSame(start)) &&
        (txDate.isBefore(end) || txDate.isSame(end))
      );
    });

    const profitSelected = getProfit(txsInPeriod);
    const profitTotal = getProfit(allTransactions);

    // 2. Wallet do Usuário
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: dbUser.id },
    });
    const balanceVal = Number(wallet?.balance || 0);
    const lockedVal = Number(wallet?.lockedBalance || 0);

    // Taxas do ENV
    const liquidez = this.context
      ? platformDashboardRules(this.context.tag).liquidity()
      : getPlatformTaxaEffective('GLOBAL', 'LIQUIDEZ', 0.91);
    const availableBalanceNet = this.context
      ? new Prisma.Decimal(wallet?.balance ?? 0)
          .minus(wallet?.lockedBalance ?? 0)
          .mul(liquidez)
          .toDecimalPlaces(2)
          .toNumber()
      : Number(((balanceVal - lockedVal) * liquidez).toFixed(2));

    // 3. Estornos
    const estornosAgg = this.context
      ? await this.refunds(poolIds)
      : await this.prisma.transaction.aggregate({
          where: {
            userId: { in: poolIds },
            status: TransactionStatus.REFUNDED,
            description: { contains: dbUser.cpf || 'UNDEFINED_CPF' },
          },
          _count: { id: true },
          _sum: { netAmount: true },
        });

    // 4. Saques
    const withdrawals = await this.prisma.withdrawRequest.findMany({
      where: {
        userId: dbUser.id,
        ...(this.context ? { platform: this.context.tag.toLowerCase() } : {}),
      },
      select: { createdAt: true },
    });

    const countWD = (s: Date) => {
      const startD = dayjs(s);
      return withdrawals.filter(
        (w) =>
          dayjs(w.createdAt).isAfter(startD) ||
          dayjs(w.createdAt).isSame(startD),
      ).length;
    };

    // 5. Gráficos
    const last30Days = await this.getChartData(
      30,
      'day',
      poolIds,
      dbUser.cpf || '',
    );
    const annualByMonth = await this.getChartData(
      12,
      'month',
      poolIds,
      dbUser.cpf || '',
    );

    // Participações em produtos de terceiros (somente leitura); já creditadas na carteira.
    const coproducao = this.context
      ? null
      : await coproductionTotals(this.prisma, jwtUser.sub, { start, end });

    return {
      period,
      coproducao,
      summary: {
        availableBalance: availableBalanceNet,
        balanceInProcessing: 0,
      },
      selected: {
        profit: profitSelected,
        withdrawals: countWD(start),
      },
      profit: {
        total: Number(profitTotal.total.toFixed(2)),
        maquinetas: Number(profitTotal.maquinetas.toFixed(2)),
        offers: Number(profitTotal.offers.toFixed(2)),
        today: getProfit(
          allTransactions.filter((tx) =>
            dayjs(tx.createdAt).isSame(dayjs(todayStart), 'day'),
          ),
        ),
        sevenDays: getProfit(
          allTransactions.filter((tx) =>
            dayjs(tx.createdAt).isAfter(sevenDaysAgo),
          ),
        ),
        annual: getProfit(
          allTransactions.filter((tx) =>
            dayjs(tx.createdAt).isAfter(yearStart),
          ),
        ),
        charts: {
          last30Days,
          annualByMonth,
        },
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
        thirtyDays: countWD(thirtyDaysAgo),
      },
    };
  }

  private async refunds(userIds: string[]) {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId: { in: userIds },
        status: TransactionStatus.REFUNDED,
        description: {
          contains: `[TENANT:${this.context!.tag}]`,
          mode: 'insensitive',
        },
      },
      select: { netAmount: true, description: true },
    });
    const identified = rows.filter((row) =>
      hasPlatformMarker(row.description, this.context!.tag),
    );
    return {
      _count: { id: identified.length },
      _sum: {
        netAmount: identified.reduce(
          (total, row) => total.plus(row.netAmount ?? 0),
          new Prisma.Decimal(0),
        ),
      },
    };
  }

  private async getChartData(
    count: number,
    unit: 'day' | 'month',
    poolIds: string[],
    cpf: string,
  ) {
    const data: any[] = [];
    const now = dayjs().tz(TZ);

    for (let i = count - 1; i >= 0; i--) {
      const d = now.subtract(i, unit);
      const start = d.startOf(unit).toDate();
      const end = d.endOf(unit).toDate();

      const txs = await this.prisma.transaction.findMany({
        where: {
          userId: { in: poolIds },
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: start, lte: end },
          description: {
            contains: this.context ? `[TENANT:${this.context.tag}]` : cpf,
            mode: 'insensitive' as const,
          },
        },
        select: { netAmount: true, description: true },
      });

      let val = new Prisma.Decimal(0);
      txs
        .filter(
          (tx) =>
            !this.context ||
            hasPlatformMarker(tx.description, this.context.tag),
        )
        .forEach((tx) => {
          val = val.plus(tx.netAmount || 0);
        });

      data.push({
        label: unit === 'day' ? d.format('DD/MM') : d.format('MMM'),
        value: Number(val.toFixed(2)),
      });
    }

    return data;
  }
}
