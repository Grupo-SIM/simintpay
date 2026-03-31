import { PrismaClient, WithdrawStatus } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const userId = 'ba2b57d6-e3bf-4395-af31-58454f27207a';
  
  const withdrawals = await prisma.withdrawRequest.findMany({
    where: { userId },
    select: { id: true, status: true, amount: true, createdAt: true }
  });
  
  console.log('User Withdrawals:');
  console.table(withdrawals);
  
  const active = await prisma.withdrawRequest.findFirst({
    where: { userId, status: { in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED] as any } }
  });
  
  console.log('Active Withdrawal:', active);
  
  await prisma.$disconnect();
}

main();
