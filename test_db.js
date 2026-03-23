const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const t = await prisma.transaction.findMany({
    where: {
      domPaymentId: 'bd675c88-f5b3-4a46-8197-381e2995099f'
    }
  });
  console.log("DB RESULT FOR BRENO BY domPaymentId:", t);
  
  const ext = await prisma.transaction.findMany({
    where: {
      domTransactionId: '4167519d-47c8-410b-bd01-c77661da8ebd'
    }
  });
  console.log("DB RESULT FOR BRENO BY domTransactionId:", ext);

  const all = await prisma.transaction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3
  });
  console.log("LAST 3 IN DB:");
  all.forEach(x => console.log(x.id, x.domPaymentId, x.userId, x.customerName));
  
  await prisma.$disconnect();
}

run();
