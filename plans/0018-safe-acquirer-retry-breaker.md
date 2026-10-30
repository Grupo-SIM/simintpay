# Tentativas seguras entre adquirentes e circuit breaker

## Contexto

O checkout canônico escolhe a adquirente mais barata antes da cobrança, mas hoje não pode encaminhar uma falha comprovada para a próxima sem perder a identidade idempotente e a auditoria. Timeouts e respostas incertas nunca provam que não houve cobrança. O serviço também precisa de proteção distribuída contra indisponibilidade das adquirentes.

## Etapas

- [x] Persistir tentativas por transação, referências únicas e estados/evidência de falha; histórico sem tentativa permanece legível.
- [x] Integrar checkout canônico, webhooks e reconciliação conservadora: apenas prova pré-dispatch permite fallback automático; falha remota ambígua continua bloqueada. Preservar total e repasse ao alternar a adquirente.
- [x] Implementar breaker Postgres por adquirente e operação com janela móvel, sondagem cercada e bloqueio em indisponibilidade; integrar na criação canônica.
- [ ] Validar hooks, conjuntos de testes e integração nos branches originais. Não há consulta autoritativa por referência sem ID remoto em DOM/FRENDZ; tais tentativas UNKNOWN exigem investigação e não liberam retry.

Nenhum push/deploy/consulta real a adquirentes ou migração compartilhada está autorizado.
