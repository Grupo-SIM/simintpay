const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

// Configuração do DOM (substitua com seus tokens reais)
const DOM_CONFIG = {
  token: process.env.DOM_TOKEN || 'SEU_DOM_TOKEN_AQUI',
  baseUrl: 'https://api.dompagamentos.com.br/api/v2'
};

async function testDomConnection() {
  console.log('🔌 Testando conexão com DOM...\n');

  try {
    const response = await axios.get(`${DOM_CONFIG.baseUrl}/transactions`, {
      headers: {
        'Authorization': `Bearer ${DOM_CONFIG.token}`,
        'Content-Type': 'application/json'
      },
      params: {
        page: 1,
        limit: 5
      }
    });

    console.log('✅ Conexão com DOM bem-sucedida!');
    console.log(`📊 Total de transações: ${response.data.total || 0}`);
    
    if (response.data.data && response.data.data.length > 0) {
      console.log('\n📋 Últimas transações:');
      response.data.data.forEach((tx, index) => {
        console.log(`  ${index + 1}. ID: ${tx.id} - R$${tx.amount} - ${tx.status} - ${tx.created_at}`);
      });
    }

    return true;
  } catch (error) {
    console.error('❌ Erro na conexão com DOM:', error.response?.data || error.message);
    return false;
  }
}

async function testSync() {
  console.log('🚀 Iniciando teste de sincronização...\n');

  // 1. Testar conexão com DOM
  const domConnected = await testDomConnection();
  if (!domConnected) {
    console.log('\n❌ Impossível continuar sem conexão com DOM');
    return;
  }

  // 2. Verificar transações existentes
  const existingTransactions = await prisma.transaction.count();
  console.log(`\n📊 Transações atuais no banco: ${existingTransactions}`);

  // 3. Buscar usuários para mapeamento
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      domUserId: true,
      domToken: true,
      platform: {
        select: {
          name: true,
          tag: true
        }
      }
    }
  });

  console.log(`\n👥 Usuários encontrados: ${users.length}`);

  // 4. Simular sincronização das últimas 2 horas
  console.log('\n🔄 Buscando transações das últimas 2 horas...');
  
  try {
    const beginDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const response = await axios.get(`${DOM_CONFIG.baseUrl}/transactions`, {
      headers: {
        'Authorization': `Bearer ${DOM_CONFIG.token}`,
        'Content-Type': 'application/json'
      },
      params: {
        page: 1,
        limit: 50,
        begin_date: beginDate
      }
    });

    const transactions = response.data.data || response.data.transactions || [];
    console.log(`📥 ${transactions.length} transações encontradas no DOM`);

    if (transactions.length > 0) {
      console.log('\n📋 Transações para sincronizar:');
      transactions.forEach((tx, index) => {
        console.log(`  ${index + 1}. ID: ${tx.id} - R$${tx.amount} - ${tx.status} - ${tx.customer?.email || 'Sem email'}`);
      });

      // Verificar quais já existem
      const domIds = transactions.map(tx => String(tx.id));
      const existing = await prisma.transaction.findMany({
        where: {
          OR: [
            { domPaymentId: { in: domIds } },
            { domTransactionId: { in: domIds } }
          ]
        },
        select: { id: true, domPaymentId: true, domTransactionId: true }
      });

      const existingIds = new Set([
        ...existing.map(tx => tx.domPaymentId),
        ...existing.map(tx => tx.domTransactionId)
      ].filter(Boolean));

      const newTransactions = transactions.filter(tx => !existingIds.has(String(tx.id)));
      console.log(`\n✨ ${newTransactions.length} transações novas para importar`);

      if (newTransactions.length > 0) {
        console.log('\n🎯 Transações que seriam criadas:');
        newTransactions.forEach((tx, index) => {
          console.log(`  ${index + 1}. ID: ${tx.id} - R$${tx.amount} - ${tx.status}`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Erro ao buscar transações:', error.response?.data || error.message);
  }

  // 5. Verificar configuração do cron
  console.log('\n⚙️ Verificando configuração do cron...');
  console.log('Variáveis de ambiente:');
  console.log(`  - DOM_TOKEN: ${DOM_CONFIG.token ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}`);
  console.log(`  - DISABLED_DOM_SYNC: ${process.env.DISABLED_DOM_SYNC || 'NÃO DEFINIDO'}`);
  
  await prisma.$disconnect();
  
  console.log('\n🎯 Resumo:');
  console.log('1. Configure as variáveis de ambiente no docker-compose.yml');
  console.log('2. Execute: node scripts/setup-dom-mapping.js');
  console.log('3. Execute: node scripts/check-dom-mapping.js');
  console.log('4. Reinicie o container para ativar o cron');
  console.log('5. O cron rodará automaticamente a cada minuto');
}

testSync().catch(console.error);
