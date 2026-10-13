import { getPlatformOwnerId } from '../../module.registry';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/pt-br';
import { JwtPayload } from '../../../infrastructure/security/strategies/jwt.strategy';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('pt-br');

const TZ = 'America/Sao_Paulo';

@Injectable()
export class ClienteDashboardService {
  private readonly logger = new Logger(ClienteDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDashboardData(period: string = 'hoje', jwtUser: JwtPayload) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: jwtUser.sub } });
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
    const poolIds = [
      getPlatformOwnerId('PAGATG'),
      getPlatformOwnerId('RENOVADA'),
      process.env.ADMIN_USER_ID,
    ].filter(Boolean) as string[];

    // 1. Transações filtradas por CPF na descrição (Clientes Avulsos)
    // Buscamos em todos os possíveis "pools" de transações do sistema
    const allTransactions = await this.prisma.transaction.findMany({
      where: {
        userId: { in: poolIds },
        status: TransactionStatus.COMPLETED,
        description: { contains: dbUser.cpf || 'UNDEFINED_CPF', mode: 'insensitive' as const },
      },
      select: { netAmount: true, description: true, createdAt: true },
    });

    const getProfit = (txs: any[]) => {
      let total = 0;
      let maquinetas = 0;
      let offers = 0;
      txs.forEach((tx) => {
        const net = Number(tx.netAmount || 0);
        total += net;
        if (tx.description?.includes('Maquineta') || tx.description?.includes('Terminal:')) {
          maquinetas += net;
        } else {
          offers += net;
        }
      });
      return { 
        total: Number(total.toFixed(2)), 
        maquinetas: Number(maquinetas.toFixed(2)), 
        offers: Number(offers.toFixed(2)) 
      };
    };

    const txsInPeriod = allTransactions.filter(tx => {
      const txDate = dayjs(tx.createdAt);
      return (txDate.isAfter(start) || txDate.isSame(start)) && (txDate.isBefore(end) || txDate.isSame(end));
    });

    const profitSelected = getProfit(txsInPeriod);
    const profitTotal = getProfit(allTransactions);

    // 2. Wallet do Usuário 
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: dbUser.id } });
    const balanceVal = Number(wallet?.balance || 0);
    const lockedVal = Number(wallet?.lockedBalance || 0);
    
    // Taxas do ENV
    const liquidez = getPlatformTaxaEffective('GLOBAL', 'LIQUIDEZ', 0.91);
    const availableBalanceNet = Number(((balanceVal - lockedVal) * liquidez).toFixed(2));

    // 3. Estornos
    const estornosAgg = await this.prisma.transaction.aggregate({
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
      where: { userId: dbUser.id },
      select: { createdAt: true },
    });

    const countWD = (s: Date) => {
      const startD = dayjs(s);
      return withdrawals.filter(w => dayjs(w.createdAt).isAfter(startD) || dayjs(w.createdAt).isSame(startD)).length;
    };

    // 5. Gráficos
    const last30Days = await this.getChartData(30, 'day', poolIds, dbUser.cpf || '');
    const annualByMonth = await this.getChartData(12, 'month', poolIds, dbUser.cpf || '');

    return {
      period,
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
        today: getProfit(allTransactions.filter(tx => dayjs(tx.createdAt).isSame(dayjs(todayStart), 'day'))),
        sevenDays: getProfit(allTransactions.filter(tx => dayjs(tx.createdAt).isAfter(sevenDaysAgo))),
        annual: getProfit(allTransactions.filter(tx => dayjs(tx.createdAt).isAfter(yearStart))),
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
        thirtyDays: countWD(thirtyDaysAgo),
      },
    };
  }

  private async getChartData(count: number, unit: 'day' | 'month', poolIds: string[], cpf: string) {
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
          description: { contains: cpf, mode: 'insensitive' as const },
        },
        select: { netAmount: true },
      });

      let val = 0;
      txs.forEach(tx => val += Number(tx.netAmount || 0));

      data.push({
        label: unit === 'day' ? d.format('DD/MM') : d.format('MMM'),
        value: Number(val.toFixed(2)),
      });
    }

    return data;
  }
}
