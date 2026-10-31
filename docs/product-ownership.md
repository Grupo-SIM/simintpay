# Titularidade dos produtos e contexto financeiro

Complementa `business-rules.md` para os cinco produtos existentes, sem unificá-los.

## Executor e titular

- `userId` do produto é seu titular financeiro. `createdByUserId` registra o executor das novas criações; histórico sem evidência permanece nulo.
- Admin deve escolher **um titular não administrativo ativo ou uma plataforma cadastrada**. Plataforma selecionada resolve seu dono; destinos incompatíveis são rejeitados. Não há destino implícito na conta administrativa.
- Usuário comum pode vender para si sem plataforma, mesmo possuindo várias. Permissão de operar uma plataforma não transfere seus recebíveis ao executor.
- Edições comuns preservam titular e contexto de plataforma. Transferências históricas e compensações exigem revisão e auditoria próprias; não há reatribuição automática por nome, documento, tag ou descrição.
- A conta empresarial SIM Intermediações é distinta do login administrativo e deve ser selecionada explicitamente quando for a vendedora.

## Identidade e taxas

- Identidade contratual usa `USER:<id>` estável; `CLIENT:<email>` é alias legado de conta cadastrada. Ambos são contextos reservados, não plataformas.
- Precedência de taxas: override da plataforma → override do titular → GLOBAL → padrão. Zero é override válido.
- A migração aditiva copia overrides legados preservando configurações já presentes na chave estável. Alterar e-mail não altera a identidade financeira após a migração.
- Comprador e vendedor têm documentos distintos. O CPF/CNPJ do vendedor vem do cadastro do titular; e-mail do comprador e descrição comercial não determinam quem recebe nem suas taxas.
- Não foi criado novo fluxo de verificação fiscal. Contas sem documento e contas técnicas históricas permanecem pendências para auditoria, sem documentos fabricados.

## Limites operacionais

A migração de autoria e taxas foi preparada e validada localmente, sem aplicação remota. Histórico de transações, snapshots e saldos não foi transferido. Delegação de criação não concede gestão geral dos produtos do dono; o acesso comum de listagem/edição continua limitado a titular/admin, além das APIs de plataforma existentes.

## Auditoria e reatribuição de titulares (scripts)

Ferramentas em `backend/scripts/`; nenhuma altera transações, snapshots, alocações, ledger ou carteiras.

1. **Auditoria somente leitura:** `DATABASE_URL=... bun scripts/audit-product-ownership.ts --out=relatorio.json [--mapping=mapa.json]`. Roda em transação `READ ONLY`, imprime apenas o host do banco e classifica cada produto como `OK`, `PROPOSE_TRANSFER` ou `NEEDS_DECISION`. O destino só vem do `Platform.ownerUserId` de **uma única** plataforma ativa cadastrada (ou de entrada explícita do mapa); nunca de nomes, e-mails ou descrições. Produto sem tag, com várias tags, tag não cadastrada/inativa, dono de plataforma administrativo ou participante de coprodução administrativo exige decisão. O JSON traz também contas sem CPF/CNPJ, contagens de transações/pedidos/alocações, total liquidado e um `mappingTemplate` para revisão.
2. **Mapa aprovado:** JSON `[{ "productType", "productId", "newOwnerUserId", "reason", "expectedFromUserId" }]`. Somente o usuário aprova; o template é uma proposta.
3. **Reatribuição:** `bun scripts/reassign-products.ts --mapping=mapa.json` simula (padrão). `--apply` exige `--mapping` e `--confirm-host=<host do banco>`, e opcionalmente `--actor=<id de um ADMIN>`. Tudo ocorre em uma transação, tudo-ou-nada, com bloqueio da linha do produto. Cada destino é revalidado: usuário ativo, não purgado e não `ADMIN`; toda plataforma associada deve estar cadastrada, ativa e pertencer ao destino; acordo de coprodução não pode ter participante administrativo nem o dono atual/novo. `expectedFromUserId` detecta troca concorrente. Só `userId` do produto muda, com linha em `ProductOwnershipChange` (origem, destino, ator, motivo, hash do mapa). Repetir o mesmo mapa é no-op.
4. **Histórico preservado:** cobranças já feitas mantêm o titular congelado em transações, snapshots de pedido e alocações; novas cobranças leem `product.userId`. Acordos de coprodução continuam com a versão atual (referenciam participantes, não o dono); mudar participantes segue o versionamento em [coproduction.md](coproduction.md). Correção monetária histórica não faz parte desta ferramenta.
5. **Sem API administrativa:** a reatribuição é um script operacional com confirmação de host. Uma rota exigiria nova superfície de autorização sem o mesmo controle contra execução no banco errado.
6. **Execução remota** depende da migração `20261029210000_product_ownership_changes` (tabela aditiva) e de autorização explícita do usuário.

## Operação delegada

Membro de plataforma (`User.platform`) pode **criar** produtos para o dono da plataforma; o dono é o titular e o membro fica em `createdByUserId`. Decisão: delegação é somente criação. Listagem, leitura e edição usam `userId` do produto (titular) ou ADMIN, de modo que o membro não vê nem altera o que criou. Conceder gestão exigiria um modelo de permissão explícito por plataforma (auditado, revogável, sem acesso a saque, coprodução ou taxas) e continuaria passando por `assertOwnershipPreserved`; isso fica fora desta entrega. Teste de integração cobre o isolamento.

Plano em execução: [0009](../plans/0009-titularidade-ofertas-cobrancas.md). Unificação adiada: [0010](../plans/0010-unificacao-ofertas-cobrancas.md).
