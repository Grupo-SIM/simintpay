const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function setupDomMapping() {
  console.log('⚙️ Configurando mapeamento DOM...\n');

  try {
    // 1. Criar módulo Renovada se não existir
    let renovadaModule = await prisma.tenantModule.findUnique({
      where: { slug: 'renovada' }
    });

    if (!renovadaModule) {
      renovadaModule = await prisma.tenantModule.create({
        data: {
          name: 'Renovada',
          slug: 'renovada',
          isActive: true
        }
      });
      console.log('✅ Módulo Renovada criado');
    } else {
      console.log('✅ Módulo Renovada já existe');
    }

    // 2. Configurar usuário Pedro Henrique (Renovada)
    const pedroUser = await prisma.user.findFirst({
      where: {
        email: 'pedro.henrique.diniz.2002@hotmail.com'
      }
    });

    if (pedroUser) {
      await prisma.user.update({
        where: { id: pedroUser.id },
        data: {
          tenantModuleId: renovadaModule.id,
          // Se você tiver o domUserId real do Pedro, adicione aqui:
          // domUserId: 'ID_REAL_DO_PEDRO_NO_DOM'
        }
      });
      console.log(`✅ Usuário ${pedroUser.name} configurado com módulo Renovada`);
    } else {
      console.log('❌ Usuário Pedro Henrique não encontrado');
    }

    // 3. Verificar se há variáveis de ambiente configuradas
    console.log('\n📋 Variáveis de ambiente necessárias:');
    console.log('  - DOM_TOKEN: Token master do DOM');
    console.log('  - API_DOM_MASTER_KEY: Chave master da API DOM');
    console.log('  - RENOVADA_DOM_TOKEN: Token específico da Renovada (se houver)');
    console.log('  - DISABLED_DOM_SYNC: false (para ativar o cron)');

    // 4. Listar todos os usuários para possível configuração manual
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        domUserId: true,
        domToken: true,
        tenantModule: {
          select: {
            name: true,
            slug: true
          }
        }
      },
      orderBy: {
        email: 'asc'
      }
    });

    console.log('\n👥 Todos os usuários:');
    allUsers.forEach(user => {
      console.log(`  - ${user.name} (${user.email})`);
      console.log(`    domUserId: ${user.domUserId || 'NÃO CONFIGURADO'}`);
      console.log(`    domToken: ${user.domToken ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}`);
      console.log(`    Módulo: ${user.tenantModule?.name || 'NENHUM'}`);
      console.log('');
    });

    console.log('🎯 Próximos passos:');
    console.log('1. Configure as variáveis de ambiente no docker-compose.yml');
    console.log('2. Para cada usuário que tem conta no DOM, atualize o campo domUserId');
    console.log('3. Se houver tokens específicos por módulo, configure as variáveis de ambiente correspondentes');
    console.log('4. Reinicie o container para ativar o cron');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupDomMapping();
