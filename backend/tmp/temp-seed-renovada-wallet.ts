import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const userId = 'dev-user-id-renovada'; // O ID que o bypass está injetando agora
  const email = 'dev@renovada.com';

  console.log(`Verificando usuário ${email}...`);

  let user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.log('Criando usuário...');
    user = await prisma.user.create({
      data: {
        id: userId,
        email,
        name: 'Usuário Teste Renovada',
        password: 'password', // Senha qualquer pra dev
        role: 'USER',
      },
    });
  }

  console.log(`Usuário: ${user.id}. Verificando carteira...`);

  const wallet = await prisma.wallet.findUnique({
    where: { userId: user.id },
  });

  if (!wallet) {
    console.log('Criando carteira com saldo R$ 5000,00...');
    await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: 5000.00,
        lockedBalance: 0,
      },
    });
  } else {
    console.log('Atualizando saldo da carteira para R$ 5000,00...');
    await prisma.wallet.update({
      where: { userId: user.id },
      data: {
        balance: 5000.00,
      },
    });
  }

  console.log('Feito! Agora o saque deve funcionar.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
