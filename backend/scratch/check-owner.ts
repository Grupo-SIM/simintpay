import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const linkCode = 'PX-CU8PLB';
  const plan = await prisma.pixCreditPlan.findFirst({
    where: { linkCodes: { some: { code: linkCode } } },
    include: { linkCodes: true }
  });

  if (plan) {
    console.log('PLAN FOUND:');
    console.log('ID:', plan.id);
    console.log('User ID:', plan.userId);
    console.log('Link Codes:', plan.linkCodes.map(lc => lc.code));
  } else {
    console.log('PLAN NOT FOUND for code:', linkCode);
  }

  const voucherCode = 'PREMIUM202344';
  const vouchers = await prisma.voucher.findMany({
    where: { code: voucherCode }
  });

  console.log('\nVOUCHERS FOUND with code:', voucherCode);
  vouchers.forEach(v => {
    console.log('- ID:', v.id, '| User ID:', v.userId, '| Active:', v.isActive);
  });

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
