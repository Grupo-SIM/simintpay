const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDomMapping() {
  console.log('🔍 Verificando mapeamento de usuários DOM...\n');

  // 1. Verificar usuários com domUserId
  const usersWithDomUserId = await prisma.user.findMany({
    where: {
      domUserId: { not: null }
    },
    select: {
      id: true,
      email: true,
      name: true,
      domUserId: true,
      domToken: true,
      tenantModule: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    }
  });

  console.log('📋 Usuários com domUserId:');
  usersWithDomUserId.forEach(user => {
    console.log(`  - ${user.name} (${user.email}) -> domUserId: ${user.domUserId}`);
  });

  // 2. Verificar usuários com domToken
  const usersWithDomToken = await prisma.user.findMany({
    where: {
      domToken: { not: null }
    },
    select: {
      id: true,
      email: true,
      name: true,
      domToken: true,
      tenantModule: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    }
  });

  console.log('\n🔑 Usuários com domToken:');
  usersWithDomToken.forEach(user => {
    console.log(`  - ${user.name} (${user.email}) -> tem domToken`);
  });

  // 3. Verificar módulos disponíveis
  const modules = await prisma.tenantModule.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      _count: {
        select: { users: true }
      }
    }
  });

  console.log('\n📦 Módulos disponíveis:');
  modules.forEach(module => {
    console.log(`  - ${module.name} (${module.slug}) - ${module._count.users} usuários - Ativo: ${module.isActive}`);
  });

  // 4. Verificar usuário específico da Renovada
  const renovadaUser = await prisma.user.findFirst({
    where: {
      email: 'pedro.henrique.diniz.2002@hotmail.com'
    },
    select: {
      id: true,
      email: true,
      name: true,
      domUserId: true,
      domToken: true,
      tenantModule: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    }
  });

  console.log('\n🎯 Usuário Renovada (fallback):');
  if (renovadaUser) {
    console.log(`  - ${renovadaUser.name} (${renovadaUser.email})`);
    console.log(`    domUserId: ${renovadaUser.domUserId || 'NÃO CONFIGURADO'}`);
    console.log(`    domToken: ${renovadaUser.domToken ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}`);
    console.log(`    Módulo: ${renovadaUser.tenantModule?.name || 'NENHUM'}`);
  } else {
    console.log('  ❌ Usuário não encontrado no banco!');
  }

  // 5. Verificar transações recentes sem mapeamento
  const recentTransactions = await prisma.transaction.findMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // últimas 24h
      }
    },
    select: {
      id: true,
      amount: true,
      status: true,
      domPaymentId: true,
      domTransactionId: true,
      user: {
        select: {
          email: true,
          name: true
        }
      },
      createdAt: true
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: 10
  });

  console.log('\n💳 Transações recentes:');
  if (recentTransactions.length === 0) {
    console.log('  ❌ Nenhuma transação encontrada nas últimas 24h');
  } else {
    recentTransactions.forEach(tx => {
      console.log(`  - ${tx.amount} (${tx.status}) -> ${tx.user?.name || 'SEM USUÁRIO'} - ${tx.createdAt.toLocaleString()}`);
      console.log(`    domPaymentId: ${tx.domPaymentId || 'N/A'}`);
      console.log(`    domTransactionId: ${tx.domTransactionId || 'N/A'}`);
    });
  }

  await prisma.$disconnect();
}

checkDomMapping().catch(console.error);
