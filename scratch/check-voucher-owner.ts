import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const linkCode = "PX-41OFDU";
  
  const link = await prisma.pixPlanLinkCode.findUnique({
    where: { code: linkCode },
    include: { pixCreditPlan: true }
  });
  
  if (!link) {
    console.log("Link code not found");
  } else {
    console.log("Found plan for user:", link.pixCreditPlan.userId);
    const vouchers = await prisma.voucher.findMany({
      where: { userId: link.pixCreditPlan.userId }
    });
    console.log("Vouchers for this user:", vouchers.map(v => v.code));
  }
  
  const allVouchers = await prisma.voucher.findMany({
    where: { code: "TESTE1" }
  });
  console.log("All systems vouchers with code TESTE1:", allVouchers.map(v => ({ code: v.code, userId: v.userId })));

  await prisma.$disconnect();
}

main();
