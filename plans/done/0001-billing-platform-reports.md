# Billing local nos relatórios por produto

## Objetivo

Usar contratos locais de billing e transações etiquetadas nos relatórios de comunidades, mantendo compatibilidade com pedidos de links de assinatura.

## Progresso

- [x] Criar fonte compartilhada de clientes e pagamentos por plataforma.
- [x] Integrar cards, modais e distribuição de métodos.
- [x] Padronizar etiqueta de plataforma nas cobranças de contratos.
- [x] Cobrir contratos, deduplicação, períodos e compatibilidade em testes.
- [x] Validar e criar commit local.

## Validação

- 23 suítes aprovadas.
- 97 testes aprovados.

## Decisões

- Cliente único usa `reportingCustomerId`, com fallback para `teronAccountId` e identidade da transação.
- Acesso vigente inclui `ACTIVE`, `PAST_DUE` durante carência e `CANCELLED` antes de `accessEndsAt`.
- Nenhuma migração nem alteração de contrato HTTP ou frontend.
