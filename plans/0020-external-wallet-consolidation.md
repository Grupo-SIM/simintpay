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
- [ ] Auditar mapeamento de todos os writers diretos e helpers; registrar matrizes origem/natureza e limitações. Leitor inicial NÃO oferece atribuição completa. O leitor integrado em `4e3d07c` conta linhas desconhecidas mesmo com soma zero, distingue Wallet/ledger ausentes ou inconsistentes e oferece seletor de plataforma sem disponível sacável independente.
- [x] Classificador dry-run conservador integrado em `8af55a5`: URL localhost explícita, transação `REPEATABLE READ READ ONLY`, manifesto/fingerprints versionados incluindo saldos assinados, identidade, ciclo de vida e evidências do ledger/transações. Datas normalizadas em SQL; regressão CLI em UTC/São Paulo/Tóquio. Testes PostgreSQL descartável: 2 cenários / 22 assertions; hooks/types/build aprovados.
- [ ] Resolver evidências externas: o esquema legado não possui proveniência suficiente para comprovar funding. O classificador marca todos os registros em quarentena, com indícios de espelho/representação claramente separados de prova; crédito proposto null e crédito autorizado zero NÃO significam obrigação apurada zero. Residual comprovado exige manifesto revisado; aplicação posterior exige autorização específica, fingerprint e idempotência. Nenhum comando de aplicação foi criado.
- [x] Fundação de outbox EbookSim entregue no commit `c593c7f`, já integrado à branch original `fix/checkout-token-scope` no repositório EbookSim; build/types e teste de integração (1 cenário / 8 assertions) validados. Essa entrega é infraestrutura de confirmação/retry, não ativação do protocolo financeiro.
- [ ] Identidade durável multi-plataforma, vendedor/afiliado por item, contrato EbookSim, confirmação/retry e entrega idempotente de comissão financiada pelo vendedor. Protocolo financeiro permanece pendente apesar da fundação de outbox já entregue. Snapshot/rateio da taxa fixa implementado em `a5628f2` no EbookSim: base `ITEM_GROSS`, total cobrado separado, configuração/fallback explícitos, UUID de item, vendedor e centavos imutáveis. Build/type-check e 2 cenários PostgreSQL descartável / 32 assertions aprovados; repo sem hooks ativos. Testes cobrem helper/migração/rollback e outbox, não execução Nest completa de checkout. Isso não habilita finanças.
- [x] Incremento de writers duplicados: aprovação de saque debita só a Wallet ordinária (ledger uma vez, reaprovação idempotente) e preserva `ExternalPlatformWallet`; `PlatformOwnerMirror.sync` é somente leitura e devolve o agregado da Wallet com `balanceScope: USER_WALLET_AGGREGATE` e `platformBalanceKnown: false` (Wallet ausente = saldo null com sucesso de compatibilidade, nunca zero); purga externa trava identidades/carteiras e falha fechado (409) com qualquer saldo ou locked externo diferente de zero, sem absorver nem zerar, `purgedAmount` 0. Integração real em `backend/tests/wallet-operator-writers.integration.test.ts`. Esta entrega NÃO conclui a migração externa.
- [ ] Consumidores externos pendentes: `PlatformOwnerMirror` ainda chamado por atlas-sync.service, atlas-dashboard.controller e platform-historical-sync (resposta agora agregada/desconhecida, UI antiga renderiza `balance` numérico); leitores de `externalPlatformWallet`/`externalPlatformUser` em admin-afiliados.controller, platform-administration.service, platform-seller-reports, purgeContaDireta e demais listagens do admin.controller; frontend AfiliadosTab/UsuariosTab exibem saldo externo; saldos externos legados e fluxo de quarentena/resolução manual de purga.
- [ ] Migrar writers/readers auditados e contratos de plataforma sem duplicar Wallet global por plataforma; coordenar débitos externos, espelhos e purges.
- [ ] Validar concorrência, idempotência, histórico/ownership real, soma por origem e locked, coprodução, rollback e reconciliação operacional em ambientes descartáveis.
- [ ] Após aprovação específica e manifesto revisado: ativar migração financeira e remover espelhos externos somente quando comprovadamente seguros.

## Relatórios de vendedores: incremento integrado

- `7c3102e` substitui carteiras externas como fonte monetária dos relatórios de vendedores por consulta batched ao ledger por beneficiário/plataforma. Preserva saldos assinados, agrega aliases e deduplica identidades antes da paginação genérica.
- Histórico desconhecido (mesmo líquido zero), identidade ambígua, ausência de ledger/Wallet ou cache inconsistente produzem null/status, preservados na projeção em centavos. Diálogos existentes mostram `Saldo Atribuído` e `Indisponível`, sem prometer disponibilidade sacável.
- Validação: 8 cenários / 23 assertions incluindo PostgreSQL real descartável com schema atual, sem instalar guards de produção; hooks/types/backend build/frontend build aprovados. Componentes reais conferidos em screenshots desktop 1440 e mobile 390. Frontend build terminou com avisos de DNS de fontes e tracing standalone de marketing.
- Limites: paginação genérica ainda carrega identidades correspondentes antes de deduplicar; resumos administrativos, exports, afiliados e listas de contas continuam pendentes. Não considerar o conjunto de leitores migrado.

## Resumo administrativo por plataforma

- `6d154ac` substitui saldos externos e pseudossaldos derivados de pedidos no resumo por atribuição assinada do ledger. Um statement lê membros, dimensões e reconciliação; dono administrativo é metadado, não beneficiário presumido.
- Deduplica aliases canônicos com mesmo dono e sinaliza donos conflitantes como desconhecido. Histórico desconhecido mesmo líquido zero, identidade sem vínculo, ausência de histórico/cache e inconsistência retornam null/status.
- Expõe `totalSaldoAtribuido`; `totalDisponivel` é null e `availabilityStatus: not-independent` evita prometer uma carteira sacável por plataforma. Não foi identificado consumidor frontend atual desse endpoint.
- Validação: 6 cenários / 26 assertions com PostgreSQL descartável e contratos, hooks normais (format/lint/unit/types/commitlint) e backend build aprovados. Nenhuma migração monetária ou escrita remota.

## Inventário adicional de consumidores e riscos

- Listas administrativas de contas, agrupamentos e consolidado permanecem fora dos incrementos de resumo/CSV/afiliados; não considerar a migração de leitores concluída.
- `list-withdrawals-admin.use-case.ts` ainda escolhe saldo externo em determinados saques e pode cair na Wallet agregada. A retirada dessa leitura precisa declarar o escopo agregado/atribuído sem transformar histórico desconhecido em zero.
- `recover-from-transactions.ts` ainda cria `ExternalPlatformWallet` com valores zero para identidades recuperadas. A relação é opcional: retirar essa inicialização é independente de preservar identidade, tombstones e recuperação do ledger; não remover carteiras históricas como parte dessa limpeza.
- `purgeContaDireta` exige incremento financeiro separado: condição de saldo principal não cobre carteira com somente locked, e a checagem de purga precisa ser revalidada sob lock para impedir concorrência sobrescrevendo `purgedAmount`. Não misturar essas correções com migração de leitores nem absorver saldos externos.
- Registro de plataforma pode conter aliases canônicos distintos no armazenamento (por exemplo `EBOOK`/`EBOOKSIM`, inclusive pelo cadastro Delivery). Resumos precisam deduplicar alias + dono antes dos joins e sinalizar conflito de donos como desconhecido; nunca multiplicar dinheiro ao canonicalizar.
- Saldo atribuído assinado não equivale a disponibilidade sacável da plataforma. Contratos de resumo devem separar saldo de atribuição de disponibilidade independente, que não existe.
- Vínculos de afiliados externos não podem usar igualdade de IDs entre sistemas nem e-mail. Atribuição monetária exige identidade persistida da mesma plataforma com documento normalizado e beneficiário vinculado sem conflito; ausência/ambiguidade permanece indisponível.

## Fechamento EbookSim: evidências e limite financeiro

- A criação do checkout envia um valor reduzido pelas comissões, mas o webhook dedicado Ebook recalcula a venda pelo pagamento integral e credita o vendedor por outro caminho. Esse payload não prova financiamento da comissão.
- O ACK legado da outbox significa `LEGACY_RECORDED`: a transação é registrada, mas `recordEntry` não credita a Wallet por padrão. Não habilitar `creditWallet` isoladamente, pois faltaria o débito conservado do vendedor.
- A regra de coprodução existente divide o líquido após taxas. Ainda não há decisão contratual sobre comissão de afiliado antes da divisão ou exclusivamente na parcela residual do vendedor. Não escolher uma ordem implicitamente nem financiar insuficiência com dinheiro da plataforma.
- Snapshot/rateio imutável da taxa fixa por pedido é um incremento independente; não ativa liquidação, não reconstitui pedidos antigos e não representa comissão financiada. A liquidação futura deve usar uma única fotografia com alocações, débito/crédito atômicos e reversões vinculadas.
- O checkout legado pode cobrar `originalPrice` enquanto persiste `price` nos itens. Preservar ambos os fatos: denominador do rateio explicitamente `ITEM_GROSS`, com total cobrado separado. Não usar a diferença para inventar política de desconto ou novo valor de cobrança.

## Validação e entrega

Integração PostgreSQL local descartável: atribuição + trigger, 14 cenários / 38 assertions aprovados; guard em banco descartável separado, 10 cenários / 15 assertions aprovados. Execução combinada no mesmo banco não é válida porque suites existentes deixam drift deliberado e reinstalam guards; não foi declarada aprovada. Cliente Prisma gerado em dependências próprias deste worktree, sem mutar outros worktrees. Hooks normais de commit. Build/types antes de futura integração; aprovação operacional e migração monetária permanecem pendentes. Plano continua aberto porque somente a primeira fase está implementada.
