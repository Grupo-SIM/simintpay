# 🚀 Módulo Renovada - API Machine

## 📁 Estrutura Completa

```
src/modules/renovada/
├── controllers/
│   ├── renovada-payment.controller.ts      # POST /renovada/payments/pix
│   ├── renovada-webhook.controller.ts      # POST /renovada/webhook  
│   ├── renovada-webhook-new.controller.ts # POST /renovada/webhook/dom
│   └── renovada-realtime.controller.ts   # Realtime já existente
├── services/
│   ├── payment-new.service.ts             # Serviço de pagamentos
│   ├── renovada-payment.service.ts        # Serviço original de pagamentos
│   ├── renovada-webhook.service.ts        # Webhook original
│   ├── renovada-webhook-new.service.ts   # Webhook melhorado
│   ├── webhook.service.ts                # Webhook movido para cá
│   ├── renovada-sync.service.ts          # Sync já existente
│   └── renovada-events.service.ts        # Eventos já existente
├── dtos/
│   ├── checkout-pix.dto.ts               # DTO para pagamentos PIX
│   └── checkout-credit-card.dto.ts       # DTO para pagamentos com cartão
├── events/
│   └── renovada-events.service.ts        # Eventos já existente
├── renovada.module.ts                   # Configuração do módulo
├── RENOVADA_INTEGRATION.md             # Guia completo
└── README.md                          # Este arquivo
```

## ✅ O que foi implementado:

### 1. **Pagamentos**
- ✅ DTOs para PIX e Cartão dentro do módulo
- ✅ Serviço de pagamentos completo
- ✅ Controller REST com endpoints
- ✅ Integração com DOM Pagamentos
- ✅ Cálculo automático de taxas (9% + 91%)
- ✅ Logs com prefixo `[RENOVADA]`

### 2. **Webhooks**
- ✅ Receiver para webhooks do DOM
- ✅ Processamento em tempo real
- ✅ Atualização automática de status
- ✅ Incremento automático de saldos
- ✅ Controle de idempotência
- ✅ Verificação de assinatura

### 3. **Modularização**
- ✅ Todos os arquivos dentro do módulo Renovada
- ✅ Imports locais (relativos)
- ✅ Módulo auto-contido
- ✅ Export dos serviços necessários
- ✅ Limpeza de arquivos desnecessários

## 🔧 Endpoints Disponíveis

### Pagamentos (Autenticados)
```
POST /renovada/payments/pix          # Criar pagamento PIX
POST /renovada/payments/credit-card # Criar pagamento com cartão
GET  /renovada/payments/test        # Testar API
```

### Webhooks (Públicos)
```
POST /renovada/webhook/dom          # Webhook DOM Pagamentos
POST /renovada/webhook              # Webhook genérico com assinatura
```

## 🔄 Como Funciona

1. **App Renovada** chama `POST /renovada/payments/pix`
2. **RenovadaPaymentService** cria transação DRAFT
3. **DOM Pagamentos** processa pagamento
4. **DOM** dispara webhook para `/renovada/webhook/dom`
5. **WebhookService** atualiza status para PENDING/COMPLETED
6. **Saldo** é incrementado automaticamente se COMPLETED
7. **Admin Renovada** mostra em tempo real

## 📋 Configuração Necessária

### 1. Variáveis de Ambiente
```yaml
environment:
  - DOM_TOKEN=SEU_DOM_TOKEN_AQUI
  - DOM_WEBHOOK_SECRET=SEU_WEBHOOK_SECRET_AQUI
  - URL_APP=https://simpay-back.simintermediacoes.com
  - DISABLED_DOM_SYNC=false
```

### 2. Webhook no DOM
- **URL**: `https://simpay-back.simintermediacoes.com/renovada/webhook/dom`
- **Eventos**: `transaction.paid`, `transaction.pending`, `transaction.failed`, etc.

## 🧪 Testes

### Teste de Pagamento PIX
```bash
curl -X POST "https://simpay-back.simintermediacoes.com/renovada/payments/pix" \
  -H "Authorization: Bearer SEU_TOKEN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "price": 10.00,
    "document": "12345678901",
    "document_type": "CPF",
    "email": "teste@renovada.com",
    "name": "Teste Renovada",
    "description": "Pagamento Teste"
  }'
```

### Teste de Webhook
```bash
curl -X POST "https://simpay-back.simintermediacoes.com/renovada/webhook/dom" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "transaction.paid",
    "signature": "test_signature",
    "data": {
      "id": "test_payment_123",
      "status": "paid",
      "amount": 10.00,
      "cod_external": "local_transaction_id"
    }
  }'
```

## 📊 Logs Importantes

Procure por estes logs:
```
[RENOVADA] 📱 Criando pagamento PIX para usuário
[RENOVADA] ✅ Transação criada
[RENOVADA] 📤 Enviando requisição para DOM Pagamentos
[RENOVADA] 🔔 WEBHOOK DOM RECEBIDO
[RENOVADA] 💰 Saldo atualizado
[RENOVADA] ✅ Webhook processado com sucesso
```

## 🎯 Resultado Final

O módulo Renovada agora está **100% funcional** e **auto-contido**:

✅ **Todos os arquivos dentro do módulo**
✅ **Imports relativos e locais**
✅ **Funcionalidade completa de pagamentos**
✅ **Webhooks em tempo real**
✅ **Integração com DOM Pagamentos**
✅ **Modularização correta**
✅ **Limpeza de arquivos externos**

**A api-machine agora substitui completamente a api-dom para o módulo Renovada!** 🚀
