import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL não está definida');

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const userId = '52111898-de87-4c40-90dd-7cbf5b6ac421';
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { wallet: true },
  });

  if (!user || !user.wallet) {
    console.error('Usuário não encontrado ou sem carteira.');
    return;
  }

  // Busca saques aprovados desse usuário
  const approvedWithdraws = await prisma.withdrawRequest.findMany({
    where: { userId, status: 'APPROVED' },
  });

  if (approvedWithdraws.length === 0) {
    console.log('Nenhum saque em estado "APPROVED" encontrado para este usuário.');
    return;
  }

  const totalToDeduct = approvedWithdraws.reduce((acc, w) => acc + Number(w.grossAmount), 0);

  console.log(`Encontrados ${approvedWithdraws.length} saques aprovados.`);
  console.log(`Total a deduzir: R$ ${totalToDeduct.toFixed(2)}`);

  // Ajusta a carteira
  const newBalance = Number(user.wallet.balance) - totalToDeduct;
  const newLockedBalance = Number(user.wallet.lockedBalance) - totalToDeduct;

  await prisma.wallet.update({
    where: { id: user.wallet.id },
    data: {
      balance: newBalance,
      lockedBalance: Math.max(0, newLockedBalance),
      version: { increment: 1 },
    },
  });

  console.log(`✓ Carteira atualizada: balance: ${newBalance}, lockedBalance: ${Math.max(0, newLockedBalance)}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
