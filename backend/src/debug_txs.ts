import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const txs = await prisma.transaction.findMany({
    where: {
      userId: RENOVADA_ID,
      status: 'COMPLETED',
      createdAt: { gte: today }
    },
    select: {
      id: true,
      amount: true,
      netAmount: true,
      description: true,
      createdAt: true
    }
  });

  console.log(JSON.stringify(txs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
