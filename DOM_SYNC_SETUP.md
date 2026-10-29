# Configuração de Sincronização DOM Pagamentos

## Overview

Este documento explica como configurar a sincronização automática de transações do DOM Pagamentos para a API Simpay, funcionando como a Renovada.

## 🔧 Configuração

### 1. Variáveis de Ambiente

Adicione ao `docker-compose.yml`:

```yaml
environment:
  - NODE_ENV=production
  - JWT_SECRET=secret
  - DATABASE_URL=postgresql://postgres:senha@postgres_prod:5432/simpay
  - DOM_TOKEN=seu-dom-token-aqui
  - API_DOM_MASTER_KEY=seu-dom-master-key-aqui
  - DISABLED_DOM_SYNC=false
```

**Variáveis obrigatórias:**

- `DOM_TOKEN`: Token master da conta DOM
- `API_DOM_MASTER_KEY`: Chave master da API DOM
- `DISABLED_DOM_SYNC`: Deve ser `false` para ativar o cron

### 2. Mapeamento de Usuários

Execute os scripts para configurar o mapeamento:

```bash
# 1. Verificar configuração atual
node scripts/check-dom-mapping.js

# 2. Configurar mapeamento inicial
node scripts/setup-dom-mapping.js

# 3. Testar conexão e sincronização
node scripts/test-sync.js
```

### 3. Como Funciona

#### Cron Automático

- **Frequência**: A cada minuto (`@Cron(CronExpression.EVERY_MINUTE)`)
- **Período**: Busca transações da última hora
- **Mapeamento**: Tenta associar transações a usuários locais

#### Lógica de Mapeamento (em ordem):

1. **domUserId**: Se a transação tiver `userId` nos detalhes, busca usuário correspondente
2. **Fallback Renovada**: Associa ao usuário `pedro.henrique.diniz.2002@hotmail.com`
3. **Fallback Genérico**: Primeiro usuário ativo com `tenantModule`
4. **Último Fallback**: Primeiro usuário ativo

### 4. Endpoints para Teste

#### Sincronização Manual

```bash
# Sincronizar transações de um usuário específico
POST /admin/sync-transactions
Authorization: Bearer {token}

# Testar o cron manualmente (mesma lógica do automático)
POST /admin/sync/test-cron
Authorization: Bearer {token}
```

#### Listar Transações

```bash
GET /transactions?page=1&pageSize=20
Authorization: Bearer {token}
```

## 🚀 Deploy

### 1. Atualizar Imagem Docker

```bash
docker build -t brenolima1706/back-simpay:latest .
docker push brenolima1706/back-simpay:latest
```

### 2. Atualizar Stack

```bash
docker stack deploy -c docker-compose.yml nome-do-stack
```

### 3. Verificar Logs

```bash
docker service logs nome-do-stack_api_donate
```

## 🔍 Debug

### Verificar se o Cron está Ativo

Procure nos logs:

```
🔄 [CRON] Starting automatic transaction sync from DOM Pagamentos...
```

### Verificar Variáveis de Ambiente

```bash
docker exec -it $(docker ps -q -f name=api_donate) env | grep DOM
```

### Testar Conexão Manual

```bash
curl -X POST "http://simpay-back.simintermediacoes.com/admin/sync/test-cron" \
  -H "Authorization: Bearer SEU_TOKEN"
```

## 📊 Monitoramento

### Logs Importantes

- `[CRON] Starting automatic transaction sync` - Início da sincronização
- `[CRON] Received X transactions from DOM` - Transações recebidas
- `[CRON] Sync Results: X created, Y updated, Z skipped` - Resultado

### Métricas

- Transações criadas/atualizadas por minuto
- Falhas de mapeamento
- Erros de conexão com DOM

## 🛠️ Troubleshooting

### Problema: Transações não aparecem

1. Verifique se `DISABLED_DOM_SYNC=false`
2. Confira se `DOM_TOKEN` está correto
3. Teste com `/admin/sync/test-cron`

### Problema: Transações sem usuário

1. Execute `node scripts/check-dom-mapping.js`
2. Configure `domUserId` nos usuários
3. Verifique fallbacks no código

### Problema: Erro de conexão DOM

1. Verifique token no painel DOM
2. Confira se IP está liberado
3. Teste com Postman/curl

## 📝 Exemplo de Configuração Completa

### docker-compose.yml

```yaml
version: '3.8'
services:
  api_donate:
    image: brenolima1706/back-simpay:latest
    environment:
      - NODE_ENV=production
      - JWT_SECRET=seu-secret-aqui
      - DATABASE_URL=postgresql://postgres:senha@postgres_prod:5432/simpay
      - DOM_TOKEN=seu-dom-token-aqui
      - API_DOM_MASTER_KEY=seu-dom-master-key-aqui
      - DISABLED_DOM_SYNC=false
    networks:
      - externa
      - interna
```

### Scripts de Manutenção

```bash
# Verificar sincronização
curl -X POST "http://simpay-back.simintermediacoes.com/admin/sync/test-cron"

# Verificar transações recentes
curl -X GET "http://simpay-back.simintermediacoes.com/transactions?page=1&pageSize=10"

# Logs em tempo real
docker service logs -f nome-do-stack_api_donate
```

## ✅ Checklist de Implementação

- [ ] Configurar variáveis de ambiente DOM
- [ ] Adicionar `SyncDomTransactionsCron` ao AdminModule
- [ ] Executar scripts de mapeamento
- [ ] Testar sincronização manual
- [ ] Verificar logs do cron
- [ ] Monitorar transações novas
- [ ] Configurar alertas (opcional)

---

**Após seguir estes passos, a Simpass funcionará como a Renovada, capturando transações automaticamente a cada minuto.**
