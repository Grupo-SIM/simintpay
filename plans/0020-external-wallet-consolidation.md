# Consolidação das carteiras externas

Continuação do [plano 0019](0019-balancelog-read-source.md) e do plano de trabalho original `/home/hyoretsu/.claude/plans/giggly-riding-toucan.md`.

## Decisões e limites

- User é o beneficiário; dono administrativo da plataforma não é beneficiário de todos os membros. `User.platformId` (FK única) não representa identidade/membership multi-plataforma: preservar agora, projetar vínculo durável na próxima fase.
- Comissão financiada pelo vendedor, calculada sobre bruto. Taxa fixa de serviço uma vez por pedido; múltiplos vendedores recebem rateio proporcional ao bruto dos itens, com resto de centavos determinístico. Essas regras NÃO ativam crédito financeiro neste incremento.
- Wallet permanece cache. Nenhuma remoção de carteira externa, mudança de resposta financeira ou endpoint nesta fase. Nenhum deploy, push ou banco remoto autorizado. A integração da fase 1 aditiva depende de build/types validados; não implica ativação das fases financeiras posteriores.
- `BalanceLog.platformTag` e `nature` são Strings nullable. Nature possui union TypeScript interna; tags seguem o contrato aberto String de Transaction/Platform. Evita enum Prisma público que exigiria tradução frontend antes de haver contrato exposto. Se exposto depois, traduzir valores em todos os locales. NULL é desconhecido, não GLOBAL nem origem presumida.
- Migração somente ADD COLUMN/índice; nenhum UPDATE de histórico, alteração de delta, crédito, cópia ou backfill. Nature desconhecida gravada por writers legados permanece visível como String na leitura.
- Source do processador não é plataforma. Não classificar por descrição, dono atual ou heurísticas. Apenas coprodução recebe dimensões explícitas do próprio Transaction; demais writers aguardam auditoria.

## Execução

- [x] Fase 1: dimensões nullable aditivas; helper aceita dimensões opcionais; coprodução usa origem persistida e natureza explícita sem alterar valores; leitor interno por beneficiário agrupa plataforma/natureza em um statement MVCC, inclui bucket desconhecido, saldo e locked assinados, soma equivalente ao ledger e cache observado no mesmo snapshot. Disponível tem piso somente global; buckets não são carteiras sacáveis independentes. Drift é reportado, não corrigido. Integração descartável cobre legado, migração, soma, segregação de beneficiários, helper/setter e guards existentes.
- [ ] Auditar mapeamento de todos os writers diretos e helpers; registrar matrizes origem/natureza e limitações. Leitor inicial NÃO oferece atribuição completa.
- [ ] Classificador dry-run de externos: espelho comprovado = zero crédito; obrigação residual comprovada = manifesto revisável; ambiguidade = quarentena. Aplicação posterior exige autorização específica, fingerprint e idempotência.
- [x] Fundação de outbox EbookSim entregue no commit `c593c7f`, já integrado à branch original `fix/checkout-token-scope` no repositório EbookSim; build/types e teste de integração (1 cenário / 8 assertions) validados. Essa entrega é infraestrutura de confirmação/retry, não ativação do protocolo financeiro.
- [ ] Identidade durável multi-plataforma, vendedor/afiliado por item, contrato EbookSim, confirmação/retry e entrega idempotente de comissão financiada pelo vendedor. Protocolo financeiro permanece pendente apesar da fundação de outbox já entregue. Implementar rateio de taxa fixa acima antes de habilitar finanças.
- [ ] Migrar writers/readers auditados e contratos de plataforma sem duplicar Wallet global por plataforma; coordenar débitos externos, espelhos e purges.
- [ ] Validar concorrência, idempotência, histórico/ownership real, soma por origem e locked, coprodução, rollback e reconciliação operacional em ambientes descartáveis.
- [ ] Após aprovação específica e manifesto revisado: ativar migração financeira e remover espelhos externos somente quando comprovadamente seguros.

## Validação e entrega

Integração PostgreSQL local descartável: atribuição + trigger, 14 cenários / 38 assertions aprovados; guard em banco descartável separado, 10 cenários / 15 assertions aprovados. Execução combinada no mesmo banco não é válida porque suites existentes deixam drift deliberado e reinstalam guards; não foi declarada aprovada. Cliente Prisma gerado em dependências próprias deste worktree, sem mutar outros worktrees. Hooks normais de commit. Build/types antes de futura integração; aprovação operacional e migração monetária permanecem pendentes. Plano continua aberto porque somente a primeira fase está implementada.
