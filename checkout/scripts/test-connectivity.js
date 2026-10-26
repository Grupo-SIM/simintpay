#!/usr/bin/env node

/**
 * Script para testar conectividade das APIs
 * Útil para diagnosticar problemas em dispositivos mobile
 */

const https = require('https');
const http = require('http');

// Configurações de teste
const TEST_CONFIG = {
  timeout: 30000,
  retries: 3,
  endpoints: [
    {
      name: 'API DOM - Health Check',
      url: 'https://api-dom.jbmidia.com/health',
      method: 'HEAD',
      expectedStatus: 200,
    },
    {
      name: 'API DOM - Plan Details',
      url: 'https://api-dom.jbmidia.com/plan/link-code-plan-details/TEST/checkout',
      method: 'GET',
      expectedStatus: 404, // Esperado para código TEST inválido
    },
    {
      name: 'Backend Ebooksim',
      url: 'https://back.ebooksim.com/checkout/orders/TEST',
      method: 'GET',
      expectedStatus: 401, // Esperado sem token
    },
  ],
};

// Função para fazer requisição HTTP/HTTPS
function makeRequest(url, method = 'GET', timeout = TEST_CONFIG.timeout) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      timeout: timeout,
      headers: {
        'User-Agent': 'Mobile-Connectivity-Test/1.0',
      },
    };

    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: data,
          responseTime: Date.now() - startTime,
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    const startTime = Date.now();
    req.end();
  });
}

// Função para testar endpoint com retry
async function testEndpoint(endpoint, attempt = 1) {
  try {
    console.log(`\n🔍 Testando: ${endpoint.name}`);
    console.log(`   URL: ${endpoint.url}`);
    console.log(`   Tentativa: ${attempt}/${TEST_CONFIG.retries}`);

    const startTime = Date.now();
    const response = await makeRequest(endpoint.url, endpoint.method);
    const totalTime = Date.now() - startTime;

    console.log(
      `   ✅ Status: ${response.status} (esperado: ${endpoint.expectedStatus})`,
    );
    console.log(`   ⏱️  Tempo de resposta: ${response.responseTime}ms`);
    console.log(`   📊 Tamanho da resposta: ${response.data.length} bytes`);

    if (response.status === endpoint.expectedStatus) {
      console.log(`   🎯 Status correto!`);
    } else {
      console.log(`   ⚠️  Status diferente do esperado`);
    }

    return {
      success: true,
      response,
      endpoint,
    };
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}`);

    if (attempt < TEST_CONFIG.retries) {
      console.log(`   🔄 Tentando novamente em 2 segundos...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return testEndpoint(endpoint, attempt + 1);
    } else {
      console.log(`   💥 Falha após ${TEST_CONFIG.retries} tentativas`);
      return {
        success: false,
        error: error.message,
        endpoint,
      };
    }
  }
}

// Função principal de teste
async function runConnectivityTests() {
  console.log('🚀 Iniciando testes de conectividade para dispositivos mobile');
  console.log('='.repeat(60));

  const results = [];
  const startTime = Date.now();

  // Testar cada endpoint
  for (const endpoint of TEST_CONFIG.endpoints) {
    const result = await testEndpoint(endpoint);
    results.push(result);
  }

  // Resumo dos resultados
  const totalTime = Date.now() - startTime;
  const successfulTests = results.filter((r) => r.success).length;
  const failedTests = results.filter((r) => !r.success).length;

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO DOS TESTES');
  console.log('='.repeat(60));
  console.log(`⏱️  Tempo total: ${totalTime}ms`);
  console.log(`✅ Testes bem-sucedidos: ${successfulTests}`);
  console.log(`❌ Testes com falha: ${failedTests}`);
  console.log(
    `📈 Taxa de sucesso: ${((successfulTests / results.length) * 100).toFixed(1)}%`,
  );

  // Detalhes dos erros
  if (failedTests > 0) {
    console.log('\n❌ DETALHES DOS ERROS:');
    results
      .filter((r) => !r.success)
      .forEach((result, index) => {
        console.log(
          `   ${index + 1}. ${result.endpoint.name}: ${result.error}`,
        );
      });
  }

  // Recomendações
  console.log('\n💡 RECOMENDAÇÕES:');
  if (failedTests === 0) {
    console.log('   ✅ Todas as APIs estão respondendo corretamente');
    console.log(
      '   ✅ Problemas mobile podem estar relacionados ao dispositivo/navegador',
    );
  } else {
    console.log('   ⚠️  Algumas APIs não estão respondendo');
    console.log('   🔧 Verificar status dos servidores');
    console.log(
      '   📱 Problemas mobile podem estar relacionados à conectividade',
    );
  }

  console.log('\n📱 PARA DISPOSITIVOS MOBILE:');
  console.log('   • Verificar conexão WiFi/dados móveis');
  console.log('   • Testar em diferentes navegadores');
  console.log('   • Verificar se o dispositivo tem RAM suficiente');
  console.log('   • Testar com conexão mais estável');

  return results;
}

// Executar testes se chamado diretamente
if (require.main === module) {
  runConnectivityTests()
    .then(() => {
      console.log('\n✨ Testes concluídos!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Erro durante os testes:', error);
      process.exit(1);
    });
}

module.exports = { runConnectivityTests, testEndpoint };
