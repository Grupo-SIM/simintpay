# Plataformas e configuração financeira

## Cadastro e dono

Plataforma existe somente após cadastro explícito em `Platform`, com dono obrigatório em `User`. Usuário ativo cria plataformas próprias; administrador atribui e transfere para outro usuário ativo. Uma pessoa pode possuir várias plataformas. Tags `GLOBAL`, `SIMINTPAY` e `CLIENT:<email>` são contextos financeiros reservados, não plataformas descobertas.

TenantModule representa vínculo explícito de membros. Nome, e-mail, documento, webhook, descrição ou posse de token não criam plataforma, dono ou usuário. Rotinas de descoberta e seeds de plataformas foram removidas. Tags históricas nas transações continuam servindo para agrupamento; não criam cadastro.

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

## Migração e carteira

`scripts/migrate-owned-platforms.ts` faz inventário por padrão. `--apply` aplica somente a migração de plataformas/configurações, registra checksum no histórico Prisma, preserva donos comprovados e atribui pendências a `01a122a5-4743-7562-8f01-c84182eaafd1`. Contas técnicas automáticas são desativadas, preservando seus registros históricos. Tokens sem vínculo inequívoco não são atribuídos automaticamente.

Taxas efetivas anteriores, liquidez de saque, juros e credenciais são capturados antes de retirar variáveis antigas. Migração bloqueia divergências de juros não representáveis numa tabela única. Totais financeiros são conferidos antes/depois sob bloqueio transacional. Não move lançamentos nem saldos. Reexecução é idempotente. Snapshot local protegido permite rollback apenas se não houver atividade financeira ou mudança de cadastros posterior.

Carteira pertence ao usuário, não à plataforma. Plataformas com mesmo dono compartilham carteira; selecionar plataforma define política do saque e persiste `WithdrawRequest.platform`, sem criar saldo separado. Relatórios agrupam tags explícitas; histórico sem tag de dono compartilhado fica não identificado. Resumo marca `walletScope=shared-owner` quando saldo não é individualizável. Manutenção antiga que zerava/recalculava carteira inteira por plataforma é bloqueada quando dono possui várias plataformas.

## Núcleo canônico de plataformas

Operações canônicas usam `/platforms/:tag/payments`, `/finance`, `/reports`, `/events`, `/sync` e `/maintenance`. Cadastro/configuração/juros continuam nas APIs existentes. Valores novos usam centavos inteiros; cálculos usam `Prisma.Decimal`. Resolução consulta cadastro, dono ativo e papel atual antes de qualquer adapter. Tags corporativas exigem admin no cadastro.

`INBOUND_TOKEN` autentica somente plataforma vinculada e dono atual; transferir dono não reemite token. Escopo padrão é `payments:create`; `INBOUND_OPERATIONS` permite associação administrativa explícita de operações separadas por vírgula. Manutenção exige sessão de admin, nunca token de integração. Nenhum corpo substitui contexto autenticado. Configuração ausente não infere token de contas históricas. Diagnóstico administrativo lista vínculos faltantes sem expor segredos.

Relatórios canônicos atribuem somente transações com marca explícita da plataforma. Saldo continua pertencendo ao usuário; dono de várias plataformas recebe `walletScope=shared-owner`. Manutenção de carteira compartilhada fica bloqueada. Saques canônicos reservam carteira e usam idempotência vinculada à plataforma; saques Return Bet permanecem pendentes de aprovação.

Return Bet consulta comunidade somente após associação administrativa `COMMUNITY_PLATFORM_TAG` a plataforma cadastrada e ativa com dono ativo. Nenhuma plataforma `VIVENDO-DE-BET` é criada automaticamente. Ausência/inatividade dessa associação retorna 422 com `PLATFORM_CAPABILITY_UNAVAILABLE`, sem afetar outras capacidades.

Barramento único mantém canal por tag e espécie de evento; facades legadas preservam payloads e nomes SSE. Scheduler único percorre plataformas configuradas; chamadas simultâneas por plataforma compartilham execução. Contratos legados estão inventariados em `docs/legacy-platform-routes.md`; permissões antigas não se aplicam às APIs canônicas.

Comerciantes canônicos usam `IntegrationMerchant.integrationKey=platform:<id>` e associam conta ativa já cadastrada por CNPJ. Rotas antigas de integração resolvem `LEGACY_MERCHANT_KEYS` cadastrado pelo admin; vínculo ausente/ambíguo retorna 422 e nunca escolhe Zero Grau automaticamente. Cadastro de comerciante não cria usuário técnico. Clientes Return Bet sem `ReturnBetAccount` exigem associação administrativa explícita em `PUT /platforms/RETURN-BET/return-bet/accounts/:externalUserId` com `{ "userId": "..." }`.

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
