import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const vouchers = await prisma.voucher.findMany();
  console.log(JSON.stringify(vouchers, null, 2));
  await prisma.$disconnect();
}

main();
