import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';
  const txs = await prisma.transaction.findMany({
    where: { userId: RENOVADA_ID },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });
  console.log(JSON.stringify(txs, null, 2));

  const totalReceived = await prisma.transaction.aggregate({
    where: { userId: RENOVADA_ID, status: 'COMPLETED' },
    _sum: { netAmount: true },
  });
  console.log('Total Received (Completed):', totalReceived._sum.netAmount);

  const totalWithdrawn = await prisma.withdrawRequest.aggregate({
    where: { userId: RENOVADA_ID, status: { in: ['COMPLETED', 'APPROVED'] } },
    _sum: { amount: true },
  });
  console.log('Total Withdrawn:', totalWithdrawn._sum.amount);
}

main();
