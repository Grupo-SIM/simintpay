import { PrismaClient, WithdrawStatus, TransactionStatus, Prisma } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const userId = 'ba2b57d6-e3bf-4395-af31-58454f27207a';
  const fatorLiquidez = 0.91;
  const taxaFixa = 2;

  const txRows = await prisma.transaction.findMany({
    where: { userId, status: TransactionStatus.COMPLETED, amount: { gt: 0 } },
    select: { amount: true, netAmount: true },
  });

  const sumNet = txRows.reduce((s, t) => {
    const net = t.netAmount != null 
      ? new Prisma.Decimal(t.netAmount.toString()) 
      : new Prisma.Decimal(t.amount.toString()).mul(fatorLiquidez);
    return s.add(net);
  }, new Prisma.Decimal(0));

  const completedWithdraws = await prisma.withdrawRequest.aggregate({
    where: { userId, status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] } },
    _sum: { grossAmount: true },
  });

  const totalWithdrawnLiquid = new Prisma.Decimal(completedWithdraws._sum.grossAmount?.toString() ?? '0').mul(new Prisma.Decimal(fatorLiquidez.toString()));

  const pendingRequests = await prisma.withdrawRequest.findMany({
    where: { userId, status: WithdrawStatus.PENDING },
  });

  const lockedBalanceGross = pendingRequests.reduce((s, r) => s + Number(r.grossAmount), 0);
  const lockedBalanceLiquid = pendingRequests.reduce((s, r) => s + (Number(r.grossAmount) * fatorLiquidez), 0);

  const netBalanceAvailable = sumNet.sub(totalWithdrawnLiquid).sub(lockedBalanceLiquid);
  const availableBalanceGross = netBalanceAvailable.div(new Prisma.Decimal(fatorLiquidez.toString()));

  console.log('--- DIAGNÓSTICO FINANCEIRO (Renovada) ---');
  console.log('Total Lucro Bruto (Txs):', txRows.reduce((s, t) => s + Number(t.amount), 0));
  console.log('Total Lucro Líquido (SumNet):', sumNet.toNumber());
  console.log('Total Sacado Bruto (Comp/Appr):', completedWithdraws._sum.grossAmount?.toString() || '0');
  console.log('Total Sacado Líquido (Consumido):', totalWithdrawnLiquid.toNumber());
  console.log('Bloqueado Atual Bruto:', lockedBalanceGross);
  console.log('Saldo Líquido Disponível:', netBalanceAvailable.toNumber());
  console.log('Saldo Bruto Disponível (availableBalance):', availableBalanceGross.toNumber());
  console.log('Saldo Líquido Estimado (netBalance):', availableBalanceGross.sub(taxaFixa).toNumber());
  
  await prisma.$disconnect();
}

main();
