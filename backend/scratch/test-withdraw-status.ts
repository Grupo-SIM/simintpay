
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const id = '15102185-4b90-475b-b3fe-4ba5dbc7e76f';
  
  const withdraw = await prisma.withdrawRequest.findUnique({
    where: { id },
    select: { id: true, status: true, rejectionReason: true },
  });
  
  console.log('Withdraw data from Prisma:', JSON.stringify(withdraw, null, 2));
  await prisma.$disconnect();
}

main();
