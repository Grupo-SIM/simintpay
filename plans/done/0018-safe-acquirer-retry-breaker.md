# Tentativas seguras entre adquirentes e circuit breaker

## Contexto

O checkout canônico escolhe a adquirente mais barata antes da cobrança, mas hoje não pode encaminhar uma falha comprovada para a próxima sem perder a identidade idempotente e a auditoria. Timeouts e respostas incertas nunca provam que não houve cobrança. O serviço também precisa de proteção distribuída contra indisponibilidade das adquirentes.

## Etapas

- [x] Persistir tentativas por transação, referências únicas e estados/evidência de falha; histórico sem tentativa permanece legível.
- [x] Integrar checkout canônico, webhooks e reconciliação conservadora: apenas prova pré-dispatch permite fallback automático; falha remota ambígua continua bloqueada. Preservar total e repasse ao alternar a adquirente.
- [x] Implementar breaker Postgres por adquirente e operação com janela móvel, sondagem cercada e bloqueio em indisponibilidade; integrar na criação canônica.
- [x] Validar conjuntos de testes: 116 testes Bun aprovados (tentativas, checkout/pagamentos unificados, circuit breaker e consulta de status de cobrança) em 2026-11-17, num worktree isolado sobre `main`. Os hooks de pré-commit rodam na integração desta atualização.

## Limitação aceita

DOM e FRENDZ não oferecem consulta autoritativa por referência sem ID remoto no checkout. Tentativas `UNKNOWN` ficam em quarentena e **nunca liberam retry**: é o comportamento seguro desejado, não pendência de código. Investigar uma tentativa `UNKNOWN` continua sendo ação operacional manual. A consulta por `cod_external` existente (`billing-core/charge-status-lookup.ts`) cobre só cobranças de ciclo de assinatura. Se as adquirentes passarem a expor consulta por referência, abrir plano novo para resolver `UNKNOWN` automaticamente.

Nenhum push/deploy/consulta real a adquirentes ou migração compartilhada está autorizado.
