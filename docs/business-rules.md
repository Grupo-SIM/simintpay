# Plataformas e configuração financeira

## Cadastro e dono

Plataforma existe somente após cadastro explícito em `Platform`, com dono obrigatório em `User`. Usuário ativo cria plataformas próprias; administrador atribui e transfere para outro usuário ativo. Uma pessoa pode possuir várias plataformas. Tags `GLOBAL`, `SIMINTPAY` e `CLIENT:<email>` são contextos financeiros reservados, não plataformas descobertas.

Platform é cadastro único de produto/plataforma. `Platform.ownerUserId` permite vários produtos por dono. `User.platformId` conserva vínculo explícito legado de usuário com uma plataforma; não determina nem limita produtos possuídos. Produto não cria módulo paralelo. Nome, e-mail, documento, webhook, descrição ou posse de token não criam plataforma, dono ou usuário. Rotinas de descoberta e seeds de plataformas foram removidas. Tags históricas nas transações continuam servindo para agrupamento; não criam cadastro.

## Custos e juros

Custos resolvem override da plataforma no banco → override GLOBAL no banco → padrão do código. Variáveis de ambiente de taxas não participam. Override com zero é válido; `null` remove override. Administrador mantém custos pela API de taxas existente. Juros do comprador pertencem ao dono da plataforma, em `customerInterestRates`, com parcelas 1–12 e valores decimais entre 0 e 1. `absorbCustomerInterest` desativa juros da plataforma. Link avulso em 1x e PIX continuam sem juros.

Custos de links por parcela usam `LINK_COST_1X` a `LINK_COST_12X`. `MDR_LINK_*` não é editável pela API de custos; tabela antiga foi capturada como juros na migração. Links não aceitam override individual de juros, cashback ou taxa de débito. Custos e juros são independentes. No cálculo de links, receita de juros pertence à plataforma; gateway, custos SimIntPay e taxas fixas são descontados uma vez.

Margem negativa é permitida. Simulação autenticada informa margem e `negativeMargin` em cada parcela. Alterações de custos/juros retornam avisos por item numa simulação de R$ 100; simulação aceita outro valor para avaliar valores reais. Simulação informa estimativa, não liquidação do gateway.

## APIs

- `GET/POST /platforms`: listar/criar. Body de criação: `tag`, `name`, `ownerUserId` opcional somente para admin.
- `PATCH /platforms/:tag`: nome, estado ativo, adquirente, absorção; transferência exclusiva do admin.
- `PATCH /platforms/:tag/customer-interest-rates`: `{ "rates": { "1": 0.0152, "2": 0.0352 } }`, atualização parcial.
- `GET /platforms/:tag/customer-interest-rates/simulation?amount=100`: comprador, custos, líquido e margem por parcela.
- `GET /platforms/:id/integrations`: configurações públicas e segredos mascarados.
- `PUT /platforms/:id/integrations/:key`: `{ "value": "..." }`; `null` remove.

Cadastro de operações valida uma única plataforma ativa atribuída ao usuário ou seu módulo. Credenciais da plataforma selecionada nunca usam token de outra plataforma como fallback. Token de entrada cadastrado permite apenas endpoints de criação previstos no guard, com plataforma fixada e sem privilégio administrativo. JWT exige usuário ativo e usa papel atual do banco. Conta ou plataforma inativa deixa de autenticar integrações.

## Credenciais e ambiente

URLs, tokens, webhooks, opções de sincronização e terminais específicos ficam em `PlatformIntegration`. Segredos usam AES-256-GCM; token de entrada também recebe hash SHA-256 para autenticação. Leituras públicas de gerenciamento nunca retornam segredo. `PLATFORM_CONFIG_ENCRYPTION_KEY` contém 64 caracteres hexadecimais e deve ser preservada em backup seguro e fornecida ao processo em produção. Perder/trocar chave sem recifrar impede leitura dos segredos.

Variáveis de infraestrutura global (banco, Redis, SMTP, armazenamento, JWT, gateway global e URLs gerais) permanecem no ambiente. Cache de registro/integrações renova após 30 segundos e fecha acesso em falha/expiração; alterações administrativas recarregam cache.

Falha de descriptografia exclui toda a configuração da plataforma afetada do cache, inclusive URLs públicas, sem interromper a inicialização da API ou o carregamento das demais plataformas. O diagnóstico identifica plataforma e chave de configuração, nunca valores secretos. Recuperação exige restaurar a chave original ou recadastrar as credenciais afetadas; recarregar o cache remove valores anteriores.

## Migração e carteira

Listagem administrativa legada de maquinetas da Renovada preserva filtro pelo dono atual, consultado diretamente no cadastro com plataforma ativa e dono ativo/não expurgado. Marca TENANT não amplia consulta para vendas de donos anteriores. Cadastro ausente ou inativo retorna listagem vazia. Identificação física aceita `[ORIGEM:MAQUINETA]`, `Terminal:` ou `Maquineta`; serial do terminal preserva hífens. Consultar histórico não modifica dono, transações ou carteira.

A migração `20261014000000_unify_platform_identity` substitui vínculos de TenantModule por referências diretas a Platform e remove entidade antiga. Usa exclusivamente associação explícita anteriormente registrada em `Platform.tenantModuleId`; vínculo de usuário sem correspondência bloqueia migração com `PLATFORM_LINK_MISSING`. Não escolhe dono por e-mail/documento/slug, não cria plataforma/usuário e não altera carteiras ou lançamentos. Artefato SQL foi preparado localmente; aplicação em banco exige autorização específica. Preflight em `scripts/diagnose-platform-identity.sql` identifica vínculos faltantes.

Script antigo `migrate-owned-platforms.ts`, setup DOM e SQL manual de conta técnica estão desativados. Histórico anterior permanece no Git. Migrações SQL históricas permanecem imutáveis.

Carteira pertence ao usuário, não à plataforma. Plataformas com mesmo dono compartilham carteira; selecionar plataforma define política do saque e persiste `WithdrawRequest.platform`, sem criar saldo separado. Relatórios agrupam tags explícitas; histórico sem tag de dono compartilhado fica não identificado. Resumo marca `walletScope=shared-owner` quando saldo não é individualizável. Manutenção antiga que zerava/recalculava carteira inteira por plataforma é bloqueada quando dono possui várias plataformas.

Todo usuário criado pelos fluxos da API recebe carteira zerada na mesma operação atômica do cadastro. Garantir carteira existente é idempotente e nunca redefine saldos. Checkouts canônicos e legados de PIX e cartão inicializam carteira ausente do dono ou comerciante validado com saldo e saldo bloqueado zerados antes de cobrar. A inicialização concorrente usa `upsert` e preserva integralmente carteiras existentes; não credita pagamento antecipadamente.

## Núcleo canônico de plataformas

Operações canônicas usam `/platforms/:tag/payments`, `/finance`, `/reports`, `/events`, `/sync` e `/maintenance`. Cadastro/configuração/juros continuam nas APIs existentes. Valores novos usam centavos inteiros; cálculos usam `Prisma.Decimal`. Resolução consulta cadastro, dono ativo e papel atual antes de qualquer adapter. Tags corporativas exigem admin no cadastro.

`INBOUND_TOKEN` autentica somente plataforma vinculada e dono atual; transferir dono não reemite token. Escopo padrão é `payments:create`; `INBOUND_OPERATIONS` permite associação administrativa explícita de operações separadas por vírgula. Manutenção exige sessão de admin, nunca token de integração. Nenhum corpo substitui contexto autenticado. Configuração ausente não infere token de contas históricas. Diagnóstico administrativo lista vínculos faltantes sem expor segredos.

Relatórios canônicos atribuem somente transações com marca explícita da plataforma. Saldo continua pertencendo ao usuário; dono de várias plataformas recebe `walletScope=shared-owner`. Manutenção de carteira compartilhada fica bloqueada. Saques canônicos reservam carteira e usam idempotência vinculada à plataforma; saques Return Bet permanecem pendentes de aprovação.

Return Bet consulta comunidade somente após associação administrativa `COMMUNITY_PLATFORM_TAG` a plataforma cadastrada e ativa com dono ativo. Nenhuma plataforma `VIVENDO-DE-BET` é criada automaticamente. Ausência/inatividade dessa associação retorna 422 com `PLATFORM_CAPABILITY_UNAVAILABLE`, sem afetar outras capacidades.

Barramento único mantém canal por tag e espécie de evento; facades legadas preservam payloads e nomes SSE. Scheduler único percorre plataformas configuradas; chamadas simultâneas por plataforma compartilham execução. Contratos legados estão inventariados em `docs/legacy-platform-routes.md`; permissões antigas não se aplicam às APIs canônicas.

Comerciantes canônicos usam `IntegrationMerchant.integrationKey=platform:<id>` e associam conta ativa já cadastrada por CNPJ. Rotas antigas de integração resolvem `LEGACY_MERCHANT_KEYS` cadastrado pelo admin; vínculo ausente/ambíguo retorna 422 e nunca escolhe Zero Grau automaticamente. Cadastro genérico de comerciante não cria usuário técnico. Exceção explícita: `PUT /internal/integrations/sim-delivery_<slug>/merchants/:companyId/owner`, autenticado pelo token interno e vínculo de plataforma existente, cria o primeiro dono ativo por email com senha opcional, carteira zerada e vínculo `IntegrationMerchant` na mesma transação. CNPJ é opcional nesse fluxo e sincroniza com `User.cnpj` e `IntegrationMerchant.cnpj` quando configurado no Sim Delivery. Email/CNPJ de outra conta são conflitos; repetição preserva senha e saldos; conta inativa ou expurgada exige revisão administrativa. Sem senha, envia link próprio de definição de senha da SimIntPay após commit. Não cria sessão, plataforma, cadastro DOM ou lançamento financeiro. Clientes Return Bet sem `ReturnBetAccount` exigem associação administrativa explícita em `PUT /platforms/RETURN-BET/return-bet/accounts/:externalUserId` com `{ "userId": "..." }`.

Webhooks canônicos em `/platforms/:tag/webhooks/:acquirer` exigem autenticação com `WEBHOOK_SECRET` da plataforma: DOM valida HMAC-SHA256 do corpo bruto (`x-webhook-signature`); Frendz valida token do payload em tempo constante. Validam adquirente e marca da transação antes de chamar processamento compartilhado. Transição financeira usa comparação de status no banco; concorrente perdedor não credita saldo nem comissão. Transação histórica continua liquidando na carteira original após transferência. Eventos não são publicados entre plataformas.

Suporte canônico atual de pagamento: PIX DOM/Frendz para plataformas genéricas e adapters Atlas/Bosque/Renovada/Zero Grau. Outros contratos corporativos exigem adapter próprio e retornam 422 até sua implementação. Cartão canônico DOM aceita token, titular, BIN, bandeira e parcelas 1–12, sem armazenar token reutilizável; Frendz sem suporte retorna 422 explícito; contratos antigos de cartão continuam nos adapters legados. Manutenção canônica aceita `zero-wallet` com `{ reason }` e `set-balance` com `{ balanceCents, lockedBalanceCents?, reason }`. Exige admin e vínculo exclusivo; outras operações retornam 422. Contratos corporativos pré-existentes permanecem disponíveis nos aliases inventariados.

Pagamentos canônicos usam chave idempotente por plataforma/comerciante. Replay exige contrato idêntico, incluindo digest do cartão. Falha de transporte incerta mantém draft e responde `PAYMENT_PROCESSING` em novas tentativas, evitando cobrança repetida. Taxas gravadas usam liquidez e MDR da parcela; liquidação não recalcula esses valores.

Sincronização ignora status desconhecidos e valores inválidos. Pagamento concluído não regride para pendente/falha. Transações canônicas conservam valor bruto, líquido e taxas gravados; estorno desconta líquido original. Polls concorrentes da mesma plataforma compartilham execução, inclusive chamadas legadas. A fachada do antigo cron global delega ao único scheduler de plataformas cadastradas/configuradas, sem credencial master de fallback. Identidade de evento Frendz combina pagamento/status e nunca armazena token no payload da fila.

Correções administrativas de carteira usam transação serializável, revalidam dono/plataforma ativos e impedem carteira compartilhada mesmo quando outra plataforma está inativa. Comparação da versão evita sobrescrever saldo concorrente. Auditoria inclui valores anteriores/posteriores e motivo; histórico de transações não é apagado. Atlas, Revalida e Bosque delegam suas correções ao mesmo núcleo.


## Capacidades corporativas canônicas

`POST /platforms/:tag/subscriptions/plans` aceita `{ name, amountCents, frequency, description? }` para BETAI, PAGATG, CONTROLE-MOTORISTA e CONTROLE-PATRIMONIAL. Frequência: SEMANAL/MENSAL/ANUAL. Delega ao mesmo caso de uso de assinatura existente, fixa dono/tag e exige DOM; Frendz retorna 422 antes de qualquer gravação. `GET /platforms/:tag/subscriptions/:code/status` consulta somente assinatura identificada pela plataforma e dono atual. `GET /platforms/:tag/saas/access?email=...` consulta acesso SaaS da tag, sem misturar clientes de mesmo dono. Acesso continua sendo concedido pelos fluxos compartilhados de pagamento/webhook.

PAGATG expõe `/platforms/PAGATG/vouchers`: GET lista, POST cria, POST `/validate` valida e DELETE `/:id` remove. Desconto percentual usa `discountRate` decimal de 0 a 1; desconto fixo usa `discountAmountCents` inteiro. O adapter converte uma vez para contrato do VoucherService e força dono/canal PAGATG. Corpo não escolhe dono, canal ou recurso arbitrário.

BETAI expõe POST `/platforms/BETAI/billing` com `{ amountCents, title?, dueDate?, email? }`, GET `/billing/:code/status` e POST `/billing/subscriptions/cancel` com `{ code }`. Cobrança delega ao núcleo de links e registra Cobranca PAYABLE; não lança saldo diretamente. Registro opcional do link DOM pode falhar mantendo checkout local, como no contrato antigo, sem trocar adquirente. Configuração ausente continua erro explícito. Cancelamento usa DOM_TOKEN da plataforma e retorna quantidade de cancelamentos remotos bem-sucedidos, permitindo tentativa explícita dos restantes.

Aliases `/internal/betai/*` preservam header interno, campos em reais e respostas antigas; apenas traduzem contrato e delegam ao mesmo serviço. Dono vem de BETAI cadastrada, nunca de MASTER_ADMIN_EMAILS ou conta técnica. Histórico avulso sem identificação explícita BETAI não é atribuído automaticamente à plataforma. Associação/configuração precisa ser feita pelo admin. Novas rotas usam `billing:read`, `billing:write`, `subscriptions:read`, `subscriptions:write`, `vouchers:read` ou `vouchers:write`, cadastrados explicitamente em INBOUND_OPERATIONS; nenhuma permissão legada é herdada.


## Painel do cliente e notificações de vendas

Cliente aprovado cria/edita somente os cinco produtos atuais de sua propriedade: planos, planos PIX, links de pagamento/assinatura e boletos. Valor mínimo R$ 14,99. Sessão de admin mantém seu escopo; clientes não alteram proprietário, código público, taxas ou vínculos administrativos. URLs administrativas não autorizam cliente; endpoints de dashboard, cobranças e taxas próprias mantêm acesso autenticado por usuário.

Edição preserva campos não apresentados no formulário e links públicos. Recorrência legada de planos é recuperada do plano exato no gateway, sem inferir frequência/repetições/retentativa. Se configuração não puder ser recuperada, erro impede edição em vez de gravar valores presumidos. Alteração de preço/recorrência cria configuração no gateway mantendo ID/código locais; assinaturas existentes conservam seu plano do gateway.

Web Push é opt-in por dispositivo para cliente aprovado. Cadastro recebe assinatura padrão do navegador; usuário vem da sessão. Endpoint tem associação única a usuário; troca remove entregas anteriores. Remoção autenticada do próprio dispositivo continua permitida depois de revogar aprovação, para concluir logout.

Trigger PostgreSQL registra primeira aprovação COMPLETED dentro da transação da venda, inclusive criação já aprovada, independentemente de webhook/reconciliação. Migração marca vendas anteriormente aprovadas sem criar entregas; importações históricas mantêm data original e não alertam. Cada evento/assinatura tem entrega única. Processador periódico usa leases, backoff em falhas e remoção de assinaturas 404/410; push não faz parte do caminho crítico do pagamento. Payload contém somente ID da venda e valor, nunca dados pessoais do comprador. Cliente mostra “Venda aprovada” e abre /transacoes.

Navegador e sistema precisam permitir execução em segundo plano; encerramento completo ou permissões bloqueadas podem impedir/adiar entrega. Configuração VAPID e migração são locais nesta entrega. Provedor real, migração remota e publicação dependem de pedido específico.

`GET /auth/me` retorna `platform` para vínculo explícito legado e `ownedPlatforms` para todos os produtos possuídos. `walletScope=shared-owner` indica carteira compartilhada entre produtos; nesse caso resumo lê saldo persistido, sem reclassificar histórico sem tag. Criação financeira sem escolha de plataforma é rejeitada quando conta possui vários produtos.

Execução de pagamentos passa por PlatformPaymentExecution tanto nas APIs canônicas quanto nos aliases corporativos. Reserva draft, invocação do adquirente e anexação de referência compartilham implementação. Anexação usa CAS de DRAFT e nunca regride liquidação concorrente. Adapters preservam nomes, respostas, classificação e arredondamentos legados. Consulta `/platforms/:tag/payments/:paymentId` usa lookup compartilhado com aliases; múltiplas marcas TENANT conflitantes bloqueiam exposição. Plataforma transferida continua consultando pagamento explicitamente marcado, mantendo carteira histórica.

### Importação financeira por plataforma

- `POST /platforms/:tag/finance/entries` importa lançamentos PAGATG/EBOOK em centavos inteiros. JWT exige admin; credencial exige vínculo explícito e escopo administrativo `ledger:write`. Dono comum não pode emitir saldo. Identidade do corpo é rejeitada.
- PAGATG importa pagamento concluído e credita líquido na mesma transação. Ebook mantém pendências e comissões sem alterar saldo armazenado. Aliases internos usam mesmo escritor, conservando seleção histórica de conta e valores em reais.
- Referência duplicada conserva lançamento; colisão de conta/plataforma/valor retorna `LEDGER_REFERENCE_CONFLICT`. Corrida pelo índice único não repete crédito. Produto/dono/beneficiário inativos bloqueiam escrita. Importação DOM em adquirente diferente retorna `ACQUIRER_OPERATION_UNSUPPORTED`.
- Identificador de assinatura PAGATG é referência externa não única: várias faturas podem pertencer à mesma assinatura. Identificador de pagamento continua único.
- Espelhamento de plano exige vínculo explícito com conta/plataforma. Código global não autoriza sobrescrever plano de outro produto; legado sem atribuição exige associação administrativa.
- Tokens internos históricos são verificados exclusivamente no guard dos aliases financeiros inventariados. APIs canônicas mantêm autenticação própria; health Atlas permanece público.

### Acesso SaaS compartilhado

Listagem e pause/resume de assinantes CONTROLE-MOTORISTA/CONTROLE-PATRIMONIAL usam mesmo serviço nos aliases e em `/platforms/:tag/saas/subscribers`. ID de assinante sempre precisa pertencer à tag. Produto/dono inativo bloqueia operação. Pause congela dias restantes; resume restaura dias congelados. Comparação do estado anterior impede duas operações concorrentes de aplicar mudanças sobre cálculo obsoleto. Aliases mantêm acesso histórico; APIs canônicas exigem `subscriptions:read`/`subscriptions:write`.

### Projeções de dashboard

Atlas e Revalida compartilham consultas, gráficos, resumos e paginação. Adapters conservam liquidez e desconto de taxas de Revalida na coluna de líquido. Transações exigem marca explícita da plataforma; saques exigem campo de plataforma correspondente. Carteira armazenada permanece por usuário, compartilhada entre produtos. Histórico sem marca não é atribuído por dono. `/platforms/:tag/reports/dashboard/:view` aceita `stats`, `sales`, `withdrawals`, `summary`; valores monetários canônicos são centavos, com contagens separadas. Aliases preservam envelopes e reais.

### Inventário executável de aliases

`legacy-platform-contracts.ts` preserva inventário original de 144 pares método/caminho, com 136 contratos ativos e oito aliases administrativos BetAI retirados por decisão explícita do usuário. Telemetria registra somente método e template constantes desses contratos, nunca URL concreta, query, corpo ou credenciais. Checagem estrutural cobre 136 declarações ativas; testes de delegação cobrem 40 aliases financeiros. Equivalência estrutural/delegação não prova, isoladamente, todos os resultados financeiros dos 144 contratos.

### Claim de links AreaFlix

`/platforms/:tag/links/claim` exige admin; alias interno preserva credencial histórica. Ambos usam transação serializável e dono atual ativo. Links precisam associação explícita AREAFLIX. Apenas titularidade futura dos links muda: transações e ordens históricas conservam dono original. Transferência retroativa exige configuração administrativa `CLAIM_SOURCE_USER_ID`; e-mail do corpo não escolhe origem. Carteira compartilhada de origem ou saldo disponível insuficiente bloqueiam transferência. Logs históricos `AREAFLIX_CLAIM_TRANSFER` impedem novo crédito, inclusive após atualização do escritor.

### Liquidação compartilhada de webhooks

Bosque e entrada canônica usam mesmo normalizador, busca limitada à plataforma e chave de evento por produto/adquirente/pagamento/status. Valor líquido vem do lançamento persistido, nunca do corpo recebido. Marcas conflitantes bloqueiam liquidação. Permissão/signatura histórica fica somente no alias; entrada canônica exige segredo configurado. Processador publica confirmação de checkout e eventos de plataforma após transição efetiva. Variantes Master/Renovada sem consumidores foram removidas; rotas continuam delegando ao processador ativo pela fila existente.

### Projeções administrativas e saldo atribuído ao produto

Relatórios administrativos de plataformas, consolidado e vendedores usam o mesmo núcleo que os aliases. O consolidado canônico publica valores monetários com sufixo `Cents`; contagens continuam inteiras sem conversão. Relatórios revalidam cadastro ativo e dono atual antes das consultas. Carteira de dono com vários produtos permanece compartilhada.

`GET /platforms/:tag/finance/balance` exige `finance:read` e oferece projeção por produto, também quando o dono possui outras plataformas. Soma o líquido persistido de transações concluídas do dono atual com marca exclusiva da plataforma; desconta saques aprovados/concluídos identificados pelo produto e separa reservas pendentes. Retorna valores em centavos, saldo atribuído e saldo da carteira do dono separadamente. Não altera carteira nem autoriza saque pelo saldo projetado. Histórico de donos anteriores permanece com seus titulares.

Histórico sem marca, marcas conflitantes, saques sem plataforma e transações sem líquido persistido não são distribuídos entre produtos. Contadores e `historicalAttributionComplete` tornam essas lacunas explícitas. Saldo atribuído pode ser negativo; disponibilidade projetada tem piso zero. Regras de saque continuam aplicando disponibilidade da carteira compartilhada.


Streams legados de Atlas/Bosque/Renovada/Revalida usam projeção única do barramento, preservando headers, nomes, IDs e heartbeat imediato/a cada 20 segundos. Eventos permanecem isolados por produto.

Espelhamento administrativo de Atlas/Revalida usa núcleo transacional único. Espelha carteira do dono como projeção de compatibilidade; não cria plataforma, usuário técnico ou carteira financeira. API canônica `POST /platforms/:tag/sync/owner-mirror` exige `sync:run`, revalida dono e retorna centavos; aliases conservam reais e autenticação histórica.

Reconciliação manual Renovada e `POST /platforms/:tag/finance/reconcile` compartilham seleção por marca exclusiva, adquirente DOM e credencial cadastrada do produto. Canônico exige `sync:run` e fixa dono autenticado; alias preserva token interno e seleção opcional por usuário, sempre limitada ao produto. Configuração ausente ou adquirente sem suporte retorna 422 estável, sem usar token master como fallback.

Snapshots de saldo Return Bet não podem recalcular carteiras de usuários que possuem outro produto ou pertencem a outra plataforma. Vínculo e conta ativa são revalidados em transação serializável. Replay de saque exige mesma plataforma, conta vinculada, valor bruto e chave PIX; colisão não retorna dados de outro cliente.

Capacidades canônicas Return Bet reutilizam serviços dos oito aliases: política, comunidade simples/em lote, solicitação/status/aprovação/rejeição de saques. Entradas monetárias exigem centavos inteiros e campos conhecidos; respostas monetárias têm sufixo `Cents`. Alteração da política e revisão de saques exigem admin (`maintenance:run`); revisão registra identidade do JWT, nunca identidade escolhida pelo corpo. Tokens/anônimo legados não são aceitos como permissão canônica.

Solicitação de saque de comerciante usa mesmo escritor transacional do núcleo financeiro, nos aliases e na API canônica. Reserva verifica versão/disponibilidade da carteira; vínculo legado é revalidado contra `LEGACY_MERCHANT_KEYS`, conta e dono ativos. Registro usa tag da plataforma e adquirente cadastrado. Notificação de status é persistida no mesmo commit de banco; replay não cria nova reserva/notificação.

Sincronização histórica Atlas/Revalida compartilha persistência com polling, classificação do adapter e trava por plataforma. Importação conserva data original, estados terminais, snapshots canônicos e titular histórico; registro existente sem marca exclusiva não é adotado. Full-sync é manutenção explícita de carteira exclusiva: preserva recálculo histórico do dono e nunca distribui histórico sem tag entre produtos. Canônico `POST /platforms/:tag/maintenance/full-sync` exige admin e retorna centavos; aliases conservam envelope/unidades. O espelhamento posterior também usa núcleo único.

Comerciantes canônicos podem reutilizar associação legada existente somente por `LEGACY_MERCHANT_KEYS` explícita e sem ambiguidade entre plataformas. Não é feito backfill automático. Pagamentos, saques individuais/listagens e outbox respeitam produto e titular. Reconciliação de comerciantes não transfere transações históricas nem dinheiro entre carteiras: referências de outro titular/produto ou sem identificação retornam em `conflicts`. Cotação, consulta individual e reconciliação estão disponíveis sob `/platforms/:tag/merchants/:externalMerchantId/finance/...`, com escopos canônicos.

Oito aliases administrativos `/admin/betai/...` de mensalidades foram removidos por solicitação explícita do usuário: sistema fora do ar e endpoints upstream `/internal/mensalidade/*` inexistentes. Controller e serviço de proxy foram excluídos; rotas deixam de ser registradas (404), sem substituto canônico. Inventário histórico conserva os oito contratos como retirados e telemetria de aliases considera somente os 136 restantes. Essa capacidade sai do escopo da migração; não há pendência de schema monetário para ela. Demais integrações BetAI existentes permanecem no escopo.

Snapshots canônicos representam líquido final e não recebem novo desconto de taxas fixas. Contratos legados podem armazenar líquido anterior às taxas fixas: seu cálculo caracterizado permanece preservado. Entrada canônica sem snapshot retorna `422 PLATFORM_CAPABILITY_UNAVAILABLE` (`webhooks.net-snapshot`) antes de processar; fallback monetário antigo permanece restrito aos ingressos legados.

Frendz canônico e legado compartilham transformação de referência/status. Status de disputa/protesto convergem para mediação; status desconhecido da raiz permite fallback para status conhecido da transação. Envelope legado mantém conversão centavos→reais e assinatura determinística sem credenciais. Autenticação permissiva legada continua restrita ao alias inventariado.

Confirmação de pedido Ebook usa mesmo hook em `/webhook/ebook/payment-confirmation` e `/platforms/:tag/integrations/ebook/payment-confirmations`. Alias conserva segredo global de webhook e token interno legado; canônico exige `billing:write`, dono ativo e token cadastrado de Ebook, sem fallback global. Defaults, conteúdo e resposta do back-ebook permanecem compatíveis; logs não capturam token, tamanho de token ou payload externo.

Saldo contábil por produto está disponível para todas as plataformas com histórico identificado, genéricas ou corporativas, em `GET /platforms/:tag/finance/balance`, sem lista de produtos habilitados. Apenas lançamentos explicitamente vinculados à plataforma compõem sua projeção; histórico sem identificação permanece excluído e sinalizado na resposta. Ausência de histórico identificado não bloqueia a consulta nem autoriza atribuição automática de histórico.

Saldo contábil por produto informa `balanceBasis: persisted-net`: projeção de líquidos registrados, sem equivaler automaticamente ao valor sacável da carteira. Adapter Bosque inclui saques administrativos `bosque-baseline` na dedução atribuída; demais produtos consideram somente sua tag.

Aliases de zerar carteira Atlas/Revalida sempre passam pela manutenção serializável, inclusive quando leitura preliminar indica saldo zero. Resposta de saldo anterior e indicação `alreadyZero` vêm da leitura transacional; vínculo exclusivo, dono ativo e conflito de versão continuam obrigatórios. Operação sem mudança não gera lançamento financeiro extra, mas mantém espelhamento compatível.

E-mail de acesso VM Atlas usa mesmo serviço/template no alias e na capacidade canônica `mail/vm-access`. Canônico exige `mail:send` e plataforma Atlas; outra plataforma recebe 422 `PLATFORM_CAPABILITY_UNAVAILABLE`. Falha SMTP propaga sem resposta de sucesso em ambos os contratos; permissões legadas permanecem restritas ao alias inventariado.

Saques de dono Ebook/Pagatg precificam taxa sobre líquido. API canônica recebe bruto em centavos e resolve líquido = (bruto − taxa fixa) / (1 + taxa percentual), arredondado a centavos; mínimo incide sobre líquido. Demais produtos e saques de comerciantes mantêm base bruta; AreaFlix aplica somente taxa fixa. Escritor de saques sempre consulta plataforma/dono ativos e usa adquirente cadastrado, inclusive em aliases, sem fallback DOM. Exceções históricas sem reserva de carteira em Atlas/Ebook/Pagatg permanecem restritas aos aliases; canônico sempre reserva bruto.

Voucher Pagatg pode ser atualizado em `PATCH /platforms/:tag/vouchers/:id`, com `vouchers:write`. Usa mesmo serviço do alias; ID precisa pertencer ao dono atual e canal Pagatg. Valores fixos são centavos inteiros e percentuais são taxas decimais; trocar tipo exige valor na unidade correspondente. Cliente não substitui dono ou canais por campos do corpo.

Filtro textual de histórico Ebook é combinado com tag da plataforma, nunca a substitui. Consultas de status preservam contrato de ausência legado (PENDING em Bosque/Renovada, NOT_FOUND ou UNKNOWN nas variantes Atlas/Zero Grau); canônico retorna 404. Estados de provedor no PIX direto são normalizados para comparação financeira, sem reatribuir titular histórico.

## Integração remota — links e classificação administrativa

- `isSimintpayClient` é classificação administrativa; não altera aprovação, papel, titularidade ou associação de produtos. Ativos excluem marcados por padrão; `simintpayClients=true` seleciona marcados e `any` inclui ambos. Inativos/purgados incluem ambos por padrão.
- Admin lista globalmente os cinco produtos; `onlyMine=true` ou `1` limita ao próprio usuário. Usuário comum permanece limitado à própria conta.
- Links novos: líquido de crédito = total cobrado − custo gateway calculado − taxa do vendedor. Juros pagos pelo comprador permanecem na receita da plataforma. PIX preserva sua regra específica de gateway. Cashback e fixa adicionais são zero no breakdown; débito conserva seus descontos próprios.
- Defaults de `TAXA_LINK_PERCENT` e `LINK_COST_1X…12X`: 9%. Default global de saque: R$ 3,50. Overrides cadastrados, inclusive zero, prevalecem.
- `Transaction.settlementBasis=FINAL_NET` identifica snapshots finais dos links novos. NULL preserva contratos históricos, sem backfill financeiro. Draft fixa snapshot e dono antes da cobrança. Resposta, callback e polling liquidam com CAS, carteira e auditoria na mesma transação; estorno usa crédito efetivamente registrado. Falha incerta conserva draft para reconciliação, sem repetir automaticamente cobrança.
- Disponibilidade de saque usa `max(0, wallet.balance − wallet.lockedBalance)`; reserva não é abatida novamente. Saldo administrativo por produto reutiliza líquidos persistidos, saques explicitamente identificados e indicadores de lacunas. Bosque inclui baseline no adapter existente; carteira compartilhada continua separada da projeção.


## Consulta administrativa dos bancos externos

Cadastro ativo explícito em `Platform` e integração `EXTERNAL_DATABASE_URL` com valor criptografado são obrigatórios. Configurar via API administrativa de integrações, usando corpo `{ "value": "postgresql://…" }` (armazenado como segredo); nunca armazenar URL de banco em campo público `url` ou seis variáveis de ambiente. `PLATFORM_CONFIG_ENCRYPTION_KEY` permanece chave de criptografia do servidor; nenhuma credencial real consta deste guia.

Atlas classifica comissão de afiliado; Ebook/Revalida/Patrimonial usam papel administrativo; Patrimonial expõe organizationName da associação explícita à Organization; Pagatg/Areaflix consultam tabelas separadas de operadores e clientes. Classificação serve somente à listagem, nunca define dono. Slug inválido retorna 400. Envelopes `{ data }` e listas existentes preservados; `state` distingue `available`, `unconfigured` e `unavailable`. Conexões limitadas a dois por fonte; transações somente leitura e timeout de cinco segundos. Mudança de configuração encerra pool anterior. Falha de uma fonte não bloqueia demais. Nenhuma associação é inferida por e-mail.

### Relatório de cliente por plataforma

`GET /platforms/:tag/reports/customer` usa somente lançamentos identificados sem ambiguidade do produto e do dono atual. Respostas monetárias em centavos; contagens permanecem contagens. `ownerWalletAvailableBalanceCents` representa carteira do dono, compartilhada entre seus produtos. Alias de cliente mantém contrato histórico de CPF/pools.

### Manutenção Bosque

Baseline administrativo Bosque baixa somente disponível contábil, dentro da transação, sem movimentar carteira física. Valor aplicado nunca excede disponível atual. Ajustes por delta usam saldo transacional. Todas as operações de manutenção exigem vínculo exclusivo de carteira; APIs canônicas exigem admin. Legado Bosque conserva piso zero; canônico rejeita resultado negativo.

Consultas financeiras canônicas descartam lançamentos com marcas de plataformas conflitantes antes de contar, paginar ou somar. Todos os estados do enum de transação podem ser consultados.

### Importações corporativas

Importação de plano Pagatg existente usa `/platforms/:tag/subscriptions/plans/import`; criação de nova assinatura permanece operação distinta. Valores canônicos em centavos. Código global de plano não pode ser adotado por outro produto/conta. Lançamentos Ebook pending/commission não creditam carteira; pending conserva cálculo histórico PIX independentemente do meio exibido. Campos opcionais de comprador/parcelas não substituem identidade autenticada.

Vínculo canônico AreaFlix retorna `retroactiveTransferredCents`; alias conserva `retroactiveTransferred` em reais. Ambos usam transferência única com vínculo explícito de origem e mesmos registros de auditoria.

### Projeções administrativas canônicas

`/platforms/:tag/reports` inclui `overview`, `withdrawal-fees`, `communities`, `atlas-products`, `payment-methods`, `transactions`, `sellers` e `sellers/stats`. Valores monetários usam sufixo Cents; percentuais de distribuição e participação tornam-se taxas decimais. Quantidades não são multiplicadas por cem. Atlas products fica restrito a Atlas. Histórico com marcas conflitantes fica excluído das projeções canônicas. Dashboard legado conserva consultas históricas e formato original no núcleo compartilhado.

Configuração financeira Ebook em `/platforms/:tag/finance/config` distingue taxas decimais de custos fixos em centavos. Detalhe de saque canônico exige ID, dono e plataforma correspondentes.

Resumo canônico de comerciante mantém carteira por usuário e disponibilidade compartilhada, mas processamento de saques é limitado ao produto/namespace explícito. Política expõe `fixedCents` e `rate` decimal; alias mantém `percentBasisPoints` e seleção histórica. Provisionamento existente também exige conta ativa.

### Alcance da compatibilidade concluída

136 contratos ativos permanecem aliases/entradas compatíveis, relacionados no manifesto `docs/legacy-platform-equivalence.json`. Oito proxies administrativos BetAI retirados não recebem substituto inventado. Diferenças de autorização, reais/centavos, taxas, SSE e envelopes ficam explícitas na matriz; APIs novas não herdam permissões legadas. Carteira física continua por usuário; histórico atribuído por produto não autoriza manutenção que zere carteira compartilhada. Relatórios canônicos usam dono revalidado mesmo quando cache legado ainda aponta dono anterior.

## Política financeira versionada

- Adquirente, SimIntPay e plataforma constituem camadas independentes por adquirente/modalidade/canal/parcela. Contrato da adquirente separa fixo, percentual, cashback fixo e juros; base de processamento é original ou total do comprador. SimIntPay soma fixo/percentual e juros próprios; dono escolhe somente a proporção dos juros efetivos repassada ao comprador.
- Juros percentuais incidem no valor original; novas cobranças não aplicam adicionais do dono. Repasse zero ou opção sem juros não elimina juros SimIntPay. Líquido = total comprador − custos SimIntPay; custo da adquirente é descontado uma única vez. Diferença contra original não representa lucro contábil.
- Motor Decimal usa centavos e taxas inteiras em milionésimos. Cada componente arredonda meio para cima; última parcela recebe resíduo da divisão. Prévia, cobrança e liquidação usam esse motor e snapshot da versão aplicada.
- `FinancialPolicyRevision` é append-only, com ator e versão. Configuração efetiva combina GLOBAL e overrides explícitos, inclusive zero; ausência herda. Escritas exigem versão atual e transação serializável. Dono pode alterar somente repasse dos juros e opção sem juros; custos internos e margem são exclusivos do admin. Sessão, conta ativa, papel e propriedade são revalidados no banco.
- GET/PATCH `/platforms/:tag/financial-policy` retornam configuração efetiva, origem e versão. POST `/platforms/:tag/financial-policy/simulation` recebe modalidade, canal, valor em centavos, parcelas solicitadas e rascunho; autorização/configuração carregam uma vez, cálculo puro não consulta banco por parcela. Resposta do dono omite composição interna; falha de cálculo fica restrita à parcela.
- Ativação é explícita após contrato completo. Crédito exige todas as 12 parcelas ativas. Migração não infere juros de taxas antigas: audita personalizações anteriores, prepara adicional zero/absorção integral pelo dono e mantém política legada até ativação. Após ativação, APIs antigas de edição/simulação de juros são desabilitadas para evitar contratos contraditórios.
- Histórico, saldos e lançamentos existentes não são recalculados. Novas cobranças congelam revisão/snapshot; recorrências restauram essas revisões. Importação POS resolve configuração na data da venda e inverte total informado sem deduzir custo duas vezes. Liquidação e estorno usam lançamento final idempotente.
- Migração `20261019000000_financial_policy` validada somente em PostgreSQL temporário local. Nenhuma aplicação em banco externo, publicação ou ativação contratual real integra esta execução.


## Padrões de juros e taxas

Novas plataformas absorvem custos por padrão (`absorbCustomerInterest=true`); no motor financeiro, ausência de regra do dono implica adicional zero e `passInterestPpm=0`. Overrides explícitos continuam válidos. Juros padrão de 1 parcela são zero. Os 9% SimIntPay são custo do vendedor (`LINK_COST_*` / `sim.ratePpm`), nunca juros do comprador. Campos legados `PaymentLink.platformFee*` permanecem por compatibilidade, mas não determinam juros no cálculo atual. Migração de padrões não recalcula cobranças, saldos nem configurações explícitas de plataformas existentes.


## Repasse exclusivo dos juros ao comprador

Novas simulações e cobranças permitem somente repasse de 0% a 100% dos juros SimIntPay efetivos (`passInterestPpm`). Custos administrativos fixos e percentuais são descontados do líquido da plataforma, nunca adicionados ao comprador. Os antigos adicionais do dono permanecem no documento para compatibilidade, mas são ignorados nas cobranças atuais. Total comprador = original + juros repassados; líquido = total comprador − custos SimIntPay, sem duplicar descontos. Sem juros zera apenas juros cobrados do comprador.

Documentos novos recebem `interestOnly=true`. Snapshots novos também congelam esse indicador, inclusive quando usam uma revisão anterior à mudança. Restauração de cobrança/assinatura histórica sem indicador mantém o cálculo original da revisão. Nenhuma revisão, transação ou saldo anterior é reescrito. A API não permite ao cliente desativar essa regra por save ou draft.

- Nomenclatura financeira apresentada ao dono: custos e juros SimIntPay. SimIntPay cobre custos das adquirentes; composição por adquirente é informação interna do administrador, sem contratação separada pelo dono da plataforma.


## Relatórios por plataforma para sessões de donos

- `/relatorios/plataformas` consulta cadastro real, com pesquisa por nome/tag, ordenação por nome/tag e paginação. Admin lista todas; usuário lista somente plataformas próprias, inclusive inativas para histórico.
- `/relatorios/financeiro` e seus detalhes/séries consolidam plataformas próprias ou uma plataforma autorizada. `/relatorios/plataformas/:tag/produto` usa o mesmo escopo. Sessão de integração não acessa esses endpoints.
- Histórico pertence ao beneficiário original. Projeções exigem dono atual e marca exclusiva; sem marca, marcas conflitantes e líquido ausente não são estimados. Troca de dono não transfere receitas antigas. Datas seguem America/Sao_Paulo; limites inicial inclusivo e final exclusivo no dia seguinte.
- Respostas do dono incluem bruto, taxas totais persistidas, líquido, estornos, saques e contagens. Nunca incluem custos da adquirente ou margens SimIntPay. Projeções canônicas antigas com composição interna exigem sessão administrativa; integrações explicitamente autorizadas mantêm seus contratos.
- `/admin/relatorios/saldos-plataformas` é exclusivo do admin, com catálogo completo paginado por nome/tag. Saldo atribuído, disponível projetado e reservas vêm da mesma projeção no card/detalhe. Carteira do dono é informação separada; carteira compartilhada nunca é somada entre produtos. Histórico inativo é legível; operações financeiras continuam bloqueadas.
- Valores monetários das novas APIs são centavos; saldo atribuído negativo permanece explícito e disponível tem piso zero. Projeção não autoriza saque nem recalcula carteira.


## Saldo restante após saque

`saldoRestanteAposSaque` nas listagens administrativa e do usuário é snapshot persistido do disponível (saldo menos bloqueios). Solicitação com reserva registra disponível após bloquear o bruto; aprovação com débito local atualiza o snapshot com o disponível retornado pela carteira dentro da mesma transação. Movimentações posteriores não alteram o histórico. Histórico anterior, importações e operações sem reserva/débito confiável retornam `null`; saques recusados retornam `null`. Nenhum saldo histórico é estimado a partir da carteira atual. Migração somente preparada localmente, sem aplicação em banco.


## Plataformas próprias e catálogo de adquirentes

`GET /platforms/owned` filtra sempre pelo usuário autenticado, inclusive administradores. `GET /platforms` mantém catálogo administrativo completo. Sessões de integração não acessam nenhum desses catálogos.

`GET /platforms/acquirers` expõe código único e nome às sessões autenticadas. Cadastro inicial técnico, sem gestão pelo painel. Novas configurações financeiras aceitam somente códigos cadastrados; migração registra códigos do enum e de todas as revisões históricas, incluindo DOM, sem alterar chaves, documentos ou transações. Admin define custos e juros SimIntPay; dono define repasse ao comprador. Custos internos da adquirente permanecem visíveis somente ao admin.
