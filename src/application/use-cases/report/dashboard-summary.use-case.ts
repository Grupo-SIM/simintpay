import { Injectable } from '@nestjs/common';
import { Prisma, TransactionStatus, WithdrawStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import dayjs from 'dayjs';

@Injectable()
export class DashboardSummaryUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: { userId: string, period?: string }): Promise<any> {
    const { userId, period = 'hoje' } = input;
    
    // 1. Datas baseadas no período
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

    // 2. Dados do Usuário e Wallet
    const [user, wallet] = await Promise.all([
      this.prisma.user.findUnique({ 
        where: { id: userId }, 
        include: { tenantModule: true } 
      }),
      this.prisma.wallet.findUnique({ where: { userId } }),
    ]);

    // 3. Cálculo de Saldo Disponível conforme Liquidez do Módulo
    const slug = user?.tenantModule?.slug || null;
    const fatorLiquidez = (slug === 'renovada') ? 0.91 : 0.91; // Fallback 0.91 ou buscar de config
    
    const balance = Number(wallet?.balance || 0);
    const locked = Number(wallet?.lockedBalance || 0);
    const availableNet = (balance - locked) * fatorLiquidez;

    // 4. Resumo Financeiro (Geral)
    const [disputedAgg] = await Promise.all([
      this.prisma.transaction.count({
        where: { userId, status: TransactionStatus.CHARGEBACK },
      }),
    ]);

    // 4. Transações no período selecionado
    const txsInPeriod = await this.prisma.transaction.findMany({
      where: {
        userId,
        createdAt: { gte: start, lte: end },
      },
    });

    const totalTxsInPeriod = txsInPeriod.length;
    const paidTxs = txsInPeriod.filter(t => t.status === TransactionStatus.COMPLETED);
    // Para Renovada, mostramos lucro líquido em "Vendas"
    const totalSales = paidTxs.reduce((acc, t) => acc + Number(t.netAmount || 0), 0);
    
    const approvalRate = totalTxsInPeriod > 0 ? (paidTxs.length / totalTxsInPeriod) * 100 : 0;
    const averageTicket = paidTxs.length > 0 ? totalSales / paidTxs.length : 0;

    // 5. Métodos de Pagamento
    const pmStats = {
      pix: { count: 0, amount: 0 },
      credit: { count: 0, amount: 0 },
      debit: { count: 0, amount: 0 },
      boleto: { count: 0, amount: 0 },
    };

    paidTxs.forEach(tx => {
      const amt = Number(tx.amount || 0); // Keep original amount for payment method stats
      const method = tx.paymentMethod.toLowerCase();
      if (method.includes('pix')) { pmStats.pix.count++; pmStats.pix.amount += amt; }
      else if (method.includes('credit')) { pmStats.credit.count++; pmStats.credit.amount += amt; }
      else if (method.includes('debit')) { pmStats.debit.count++; pmStats.debit.amount += amt; }
      else { pmStats.boleto.count++; pmStats.boleto.amount += amt; }
    });

    const getPct = (amt: number) => totalSales > 0 ? (amt / totalSales) * 100 : 0;

    // 6. Canais de Venda (Ofertas vs Maquinetas) - Usando valores líquidos
    const paidOnline = paidTxs.filter(t => !t.description?.includes('Terminal:'));
    const paidPhysical = paidTxs.filter(t => t.description?.includes('Terminal:'));
    
    const onlineAmount = paidOnline.reduce((acc, t) => acc + Number(t.netAmount || 0), 0);
    const physicalAmount = paidPhysical.reduce((acc, t) => acc + Number(t.netAmount || 0), 0);

    // 7. Dados do Gráfico (Últimas 24h ou conforme período)
    const chartData: any[] = [];
    const chartPoints = (period === 'hoje' || period === 'ontem') ? 24 : 7;
    const chartUnit = (period === 'hoje' || period === 'ontem') ? 'hour' : 'day';
    
    for (let i = chartPoints - 1; i >= 0; i--) {
      const d = dayjs(end).subtract(i, chartUnit as any);
      const dStart = d.startOf(chartUnit as any).toDate();
      const dEnd = d.endOf(chartUnit as any).toDate();
      
      const pointTxs = txsInPeriod.filter(t => t.status === TransactionStatus.COMPLETED && t.createdAt >= dStart && t.createdAt <= dEnd);
      const online = pointTxs.filter(t => !t.description?.includes('Terminal:')).reduce((acc, t) => acc + Number(t.netAmount || 0), 0);
      const physical = pointTxs.filter(t => t.description?.includes('Terminal:')).reduce((acc, t) => acc + Number(t.netAmount || 0), 0);
      
      chartData.push({
        label: chartUnit === 'hour' ? d.format('HH:00') : d.format('DD/MM'),
        online,
        physical,
      });
    }

    // 8. Chargebacks (Simplificado para o dash)
    const totalRefunded = txsInPeriod.filter(t => t.status === TransactionStatus.REFUNDED).reduce((acc, t) => acc + Number(t.amount || 0), 0);
    const chargebacksCount = txsInPeriod.filter(t => t.status === TransactionStatus.CHARGEBACK).length;
    const chargebacksAmount = txsInPeriod.filter(t => t.status === TransactionStatus.CHARGEBACK).reduce((acc, t) => acc + Number(t.amount || 0), 0);

    return {
      user: { name: user?.name || 'Usuário' },
      summary: {
        availableBalance: availableNet,
        balanceInProcessing: 0,
        withdrawalsInAnalysis: 0,
        financialReserve: 0,
        disputedTransactions: disputedAgg,
        globalRetention: 0,
        blockedBalance: 0,
      },
      transactionsByPeriod: {
        totalSales,
        paidTransactions: paidTxs.length,
        approvalRate,
        averageTicket,
        installmentInterest: 0,
        onlineSalesRate: getPct(onlineAmount),
        physicalSalesRate: getPct(physicalAmount),
        chartData,
      },
      paymentMethods: {
        offers: { percentage: getPct(onlineAmount), amount: onlineAmount },
        maquinetas: { percentage: getPct(physicalAmount), amount: physicalAmount },
      },
      chargebacks: {
        totalRefunded,
        chargebackNotifications: chargebacksCount,
        refunds: { count: txsInPeriod.filter(t => t.status === TransactionStatus.REFUNDED).length, amount: totalRefunded },
        chargebackPrevention: { count: 0, amount: 0 },
        chargebacks: { count: chargebacksCount, amount: chargebacksAmount },
      },
      installments: {
        data: [
          { installments: 1, amount: totalSales, count: paidTxs.length }
        ]
      }
    };
  }
}
