# Unificar rotas e serviços de plataformas

Plano aprovado pelo usuário. Execução exclusivamente local; banco externo, push e deploy proibidos.

## Progresso

- [x] Caracterizar contratos legados: `docs/legacy-platform-routes.md` inventaria rotas, autenticação, entradas, saídas, status, unidades e SSE.
- [x] Resolver cadastro/dono ativo no banco; separar credenciais por plataforma/operação; reservar tags corporativas ao admin.
- [x] Implementar núcleo financeiro e APIs canônicas em centavos, com relatórios por marca explícita e carteira por usuário.
- [x] Extrair contratos financeiros legados em serviços; controllers delegam sem redirects/HTTP interno.
- [x] Compartilhar barramento SSE; centralizar agendamento corporativo e impedir execução concorrente por plataforma.
- [x] Exigir associação explícita da comunidade Return Bet; ausência bloqueia capacidade com 422.
- [x] Núcleo PIX DOM/Frendz e comerciantes explícitos; core legado compartilhado para Atlas/Bosque/Renovada/Zero Grau. Cartão canônico DOM implementado; Frendz sem suporte retorna 422. Contratos legados preservados.
- [x] Entrada canônica de webhook assinada; comparação atômica de status evita crédito duplicado e preserva dono histórico.
- [x] Validação dirigida com mocks: 50 testes Bun + 45 regressões Jest (+ 5 testes de cartão legado Zero Grau) aprovados.
- [x] Builds locais aprovados; commits locais com identidade Git configurada e trailer Codex.

## Evidências

Inventário obtido de HEAD antes da substituição dos controllers. Nenhuma configuração/token inferida ou banco externo alterado. Núcleo reutiliza modelos existentes; unificação adicional da identidade inclui artefato SQL local, ainda não aplicado.

## Limites verificados desta implementação

- Contratos corporativos financeiros continuam em adapters específicos, inclusive consultas e projeções próprias. Nem todos os 144 contratos inventariados têm teste de equivalência alias/canônico.
- Migração completa das capacidades corporativas e equivalência de todos os aliases ainda pendentes. Endpoints existentes permanecem ativos.
- Nenhum hook Git ativo encontrado neste checkout (somente arquivos `.sample`); commits normais não contornam hooks.

## Continuação — cartão canônico

- [x] Cartão DOM tokenizado, centavos/Decimal, taxas por parcela e replay idempotente sem persistir token.
- [x] Falha incerta mantém draft e bloqueia nova cobrança; resposta não regride status liquidado.
- [x] 12 testes de pagamentos com mocks aprovados; build local aprovado.

## Continuação — sincronização e webhooks

- [x] Adapters fixos de classificação/status, rejeição de status/valores desconhecidos e proteção de estados terminais.
- [x] Sincronização conserva líquido/taxas gravados e carteira original após transferência; CAS impede crédito concorrente.
- [x] Poll legado coalescido; antigo cron global virou fachada sem agendamento próprio/token master.
- [x] Payload DOM/Frendz normalizado antes do processamento; evento legado Frendz não usa credencial como identificador.
- [x] Webhook imediato pode liquidar draft; regressões de idempotência, refund, concorrência e isolamento aprovadas.

## Continuação — manutenção compartilhada

- [x] `zero-wallet` e `set-balance` canônicos, admin obrigatório, centavos inteiros e motivo obrigatório.
- [x] Atlas/Revalida/Bosque delegam correções/baseline ao mesmo núcleo transacional.
- [x] Associação exclusiva revalidada com isolamento serializável; versão da carteira e auditoria preservadas.
- [x] 14 testes financeiros/manutenção e build local aprovados.

## Continuação — capacidades corporativas

- [x] Planos/status BETAI/PAGATG/SaaS pelo caso de uso compartilhado; consulta de acesso SaaS isolada por tag.
- [x] Vouchers PAGATG com centavos/taxa decimal, dono/canal fixados e serviço existente compartilhado.
- [x] Cobrança avulsa/cancelamento/status BETAI extraídos; quatro aliases internos delegam ao mesmo serviço canônico, sem master por e-mail/token global.
- [x] Registro dos módulos/escopos e contratos DTO; identidade do corpo não substitui contexto.
- [x] 105 testes Bun dirigidos e 154 testes Jest aprovados; testes usam mocks. Build local final aprovado.

## Próximos itens ainda necessários para concluir o plano inteiro

- [x] Unificar execução financeira dos pagamentos legados/canônicos: PlatformPaymentExecution compartilha draft, chamada e CAS; transport DOM compartilhado e consultas de status isoladas. Respostas específicas preservadas.
- Reduzir consultas/projeções duplicadas nos adapters financeiros legados; migrar espelhamento/registro de transações PAGATG e demais capacidades corporativas ainda atendidas somente pelos contratos existentes.
- Completar testes de equivalência de todos os 144 contratos inventariados (cobertura atual dirigida, sem equivalência exaustiva).
- Validar contratos corporativos restantes de checkout/callbacks sem executar serviços externos.

Nenhum desses itens é tratado como concluído pela existência da nova rota. Implementação segue parcial quanto à migração integral dos aliases; endpoints existentes continuam atendidos. Nenhum banco externo, deploy ou push foi executado.

## Unificação da identidade — solicitação adicional

- [x] Remover modelo TenantModule; relações de usuários apontam diretamente para Platform. Ownership permanece 1:N, sem atributo único por dono.
- [x] Migrar runtime, guards, autenticação, relatórios, gateways e scripts para tag/referência Platform. Cadastro deixa de criar módulo paralelo.
- [x] Preparar SQL transacional e preflight; associação ausente bloqueia backfill. Nenhuma migração aplicada em banco.
- [x] `/auth/me` lista produtos e preserva saldo compartilhado; usuário com vários produtos precisa escolha explícita em criação financeira.
- [x] Schema Prisma validado, cliente regenerado localmente, build aprovado; 163 testes Bun e 200 Jest aprovados (1 teste pré-existente ignorado). Identidade registrada em commit local; continuação dos aliases documentada abaixo.

## Execução compartilhada de pagamentos

- [x] Atlas/Bosque/Renovada/Zero Grau e canônico delegam reserva/cobrança/persistência ao mesmo executor.
- [x] Adapter DOM separado das regras corporativas; status por referência usa lookup compartilhado e bloqueia marcas conflitantes.
- [x] Matriz de equivalência de 4 plataformas × PIX/cartão verifica lançamentos, centavos/reais, taxas, estado e ausência de crédito antecipado.
- [x] Build aprovado; 31 testes dirigidos de execução, equivalência, adapters e isolamento aprovados.

## Continuação — importação e consultas financeiras

- [x] Escritor transacional compartilhado para pagamentos externos PAGATG, pendências e comissões Ebook; idempotência concorrente e crédito atômico.
- [x] API canônica de importação em centavos, identidade autenticada e autorização específica `ledger:write`; owner comum não emite saldo.
- [x] Espelhamento de planos bloqueia colisão entre produtos; referência da assinatura não impede múltiplas faturas.
- [x] Resolver documental e paginação de saques compartilhados; guards dos aliases preservam fontes de token e exceção pública Atlas.
- [ ] Equivalência integral dos demais contratos permanece pendente; esta etapa não conclui matriz de 144.

## Continuação — administração SaaS

- [x] Listagem e toggle legados/canônicos usam PlatformSaasAccessService; filtros de tag e controle concorrente preservam isolamento.
- [x] Três testes com mocks verificam equivalência da projeção, ID estrangeiro e pause concorrente. Build local aprovado.

## Continuação — dashboards

- [x] Atlas/Revalida compartilham núcleo de projeções e adapter de regras; canônico em centavos disponível nas quatro visões.
- [x] Histórico sem marca excluído de relatórios do produto; saques filtrados por plataforma. Dono compartilhado não duplica atribuição.
- [x] Três testes de equivalência/unidades/escopo e transferência de dono aprovados; build local aprovado.

## Continuação — inventário executável

- [x] Manifesto fixo com 144 contratos e teste estrutural por rota: método, caminho, status, SSE e permissões anônimas.
- [x] Registro de uso cobre exatamente contratos inventariados; teste verifica ausência de credenciais e dados de requisição.
- [x] 40 aliases financeiros verificados quanto a argumentos, envelope e propagação de erros do serviço compartilhado.
- [ ] Resultado financeiro completo de todos os 144 contratos ainda exige equivalência comportamental adicional; manifesto não encerra essa pendência.

## Continuação — claim AreaFlix

- [x] Alias e API canônica delegam claim ao núcleo; links precisam vínculo explícito e dono ativo.
- [x] Histórico financeiro preservado; retroativo usa origem explicitamente associada pelo admin, saldo disponível e CAS de carteiras em transação serializável.
- [x] Cinco testes de integridade/idempotência e quatro de administração de integrações aprovados. Build aprovado; nenhuma configuração externa criada.

## Continuação — liquidação de callbacks

- [x] Bosque e canônico compartilham PlatformWebhookSettlement; checkout/SSE publicados pelo processador após transição.
- [x] Quatro variantes sem consumidores removidas; testes de terminal transferidos ao processador realmente utilizado.
- [x] Equivalência de normalização/líquido/chave de deduplicação e isolamento aprovados; regressões completas: 399 Bun, 200 Jest, 1 Jest pré-existente ignorado, build aprovado.

## Continuação — projeções e saldo por produto

- [x] Sete aliases administrativos delegam projeções compartilhadas; consolidado canônico em centavos revalida dono atual.
- [x] Listagem/stats de vendedores compartilham núcleo; dono com vários produtos mantém carteira compartilhada identificada.
- [x] API `finance/balance` oferece saldo atribuído ao produto junto à carteira do dono, sem repartir histórico desconhecido ou transferir titularidade histórica.
- [x] Testes dirigidos cobrem equivalência de projeções, saldo negativo, transferência, marcas conflitantes e lacunas de atribuição.
- [ ] Equivalência comportamental dos 144 contratos continua pendente; projeções e testes estruturais não substituem essa etapa.

- Validação desta etapa: 423 testes Bun, 200 Jest aprovados (1 ignorado pré-existente) e build local aprovado.

## Continuação — projeção SSE

- [x] Oito streams legados compartilham tradução do barramento; nove testes verificam headers, IDs, isolamento e heartbeat de 20 segundos. Incluídos na validação de 423 Bun e build local.

## Continuação — espelhamento do dono

- [x] Atlas/Revalida delegam espelhamento à mesma transação serializável; endpoint canônico em centavos e escopo `sync:run`.
- [x] Cinco testes cobrem equivalência de respostas/escritas, ausência de cadastro, transferência e unidades canônicas.

## Continuação — reconciliação manual isolada

- [x] Alias Renovada deixa de varrer outros produtos; serviço compartilhado com canônico valida plataforma/dono/adquirente e credencial explícita.
- [x] Marcas conflitantes/ausentes excluídas antes de chamadas ao gateway; limite e coalescência por produto.
- [x] 18 testes dirigidos e build aprovados, com gateway mockado.

## Continuação — integridade Return Bet

- [x] Bloquear snapshot externo sobre carteira compartilhada/conta inativa; transação serializável e replay validado por contrato.
- [x] Três testes de integridade e nove regressões Jest aprovados; build aprovado.

## Continuação — contratos Return Bet

- [x] Oito contratos legados dispõem de operações canônicas usando os mesmos serviços; política, comunidade em lote e ciclo de saque em centavos.
- [x] Equivalência de argumentos/envelopes/unidades, token legado inválido, capacidade ausente e campos de identidade rejeitados. Revisões canônicas usam ator do JWT.
- [x] Regressão completa anterior desta etapa: 441 Bun e 200 Jest aprovados (1 pré-existente ignorado); build aprovado. Ajuste de identidade de revisão possui teste dirigido adicional.

## Continuação — escritor financeiro de comerciantes

- [x] Remover escritor duplicado de saques: alias e canônico usam `PlatformFinanceService.createWithdrawal`, com reserva/CAS, vínculo explícito e adquirente cadastrado.
- [x] Outbox compartilhado e transacional para ambos os contratos; idempotência valida valor/chave e namespace.
- [x] Três testes de equivalência financeira, 13 testes do núcleo/comerciantes e cinco regressões Jest aprovados.

## Continuação — sincronização histórica

- [x] Atlas/Revalida deixam de implementar importação financeira própria; full-sync e polling usam mesma persistência e coordenador por plataforma.
- [x] Full-sync canônico exige admin; mantém contrato legado de recálculo exclusivo e resposta em centavos. Datas históricas preservadas, histórico sem tag não adotado.
- [x] Espelhamento após zero/full-sync também centralizado.
- [x] 15 testes de histórico/persistência aprovados: equivalência financeira/unidades, carteira compartilhada, coalescência e preservação de titularidade.

## Continuação — isolamento e compatibilidade de comerciantes

- [x] Lookup compartilhado reutiliza vínculo legado explícito, rejeitando associação ambígua; pagamento canônico usa mesmo resolver.
- [x] Listagens/detalhes de saques e outbox limitados ao produto; status de pagamento exige marca exclusiva e credencial do produto.
- [x] Reconciliação deixa de transferir titularidade histórica/carteiras: referências incompatíveis retornam conflitos.
- [x] APIs canônicas de cotação/detalhe/reconciliação compartilham serviços dos aliases, preservando centavos.
- [x] Dez testes Bun dirigidos e cinco regressões Jest aprovados.

## Continuação — administração remota BetAI

- [x] Oito proxies delegam ao adapter compartilhado, com resolução de plataforma/dono ativos e preservação do transporte legado.
- [x] Nove testes mockados verificam métodos, caminhos, headers, JSON/unidades legadas, escape, defaults e erros.
- [ ] Contrato monetário canônico de mensalidades depende de schema dos endpoints remotos `/internal/mensalidade/*`, ausentes no checkout local `../betai`. Fonte solicitada ao usuário; não inferir campos monetários de JSON opaco.

## Continuação — validação isolada

- [x] `bun scripts/test-platform-migration.ts` inicializa caches com mocks, fixa banco sentinela em loopback e falha se houver HTTP sem mock. Evita refresh implícito de taxas usando configuração do checkout.
- [x] 484 testes Bun aprovados com isolamento ativo; nenhuma chamada HTTP real na suíte.

## Continuação — snapshot e taxas de webhooks

- [x] Preservar diferença entre snapshot final canônico e líquido pré-taxas do contrato legado; leitura de taxas ocorre apenas no caminho legado.
- [x] Canônico sem snapshot líquido retorna 422 antes de lançamento; fallback antigo fica nos ingressos legados.
- [x] Testes caracterizam separadamente crédito canônico e desconto fixo legado com UUID.

## Continuação — adapter de webhook Frendz

- [x] Remover normalização duplicada do controller; entrada canônica e legado compartilham adapter, preservando unidades/envelope legado e regras de status.
- [x] 13 variantes de status/fallback comparadas entre contratos; testes de identidade dos eventos e exclusão de credenciais aprovados.

## Continuação — contratos de ingressos e confirmação Ebook

- [x] Confirmação Ebook compartilha hook entre alias e capacidade canônica; contexto ativo revalidado e credenciais canônicas específicas do produto.
- [x] Nove testes com mocks preservam seis ingressos DOM, segredo/HMAC do ingresso compartilhado e confirmação Ebook (payload/defaults/erros/identidade). Nenhuma fila ou chamada HTTP externa real.

## Continuação — regra de saldo por produto

- [x] Base contábil `persisted-net` explícita na resposta; adapter Bosque inclui baseline administrativo sem afetar regras das demais plataformas.
- [x] Seis testes de saldo cobrem carteira compartilhada, líquido ausente, marcas conflitantes, transferência, resultado negativo e baseline.

## Continuação — contratos de configuração e verificação final local

- [x] Caracterizar APIs preservadas de taxas/clientes: valores decimais, patch, tag pessoal/de membro, paginação, busca por documento e metadados omitidos. Três testes cobrem cinco handlers.
- [x] Verificação final: 493 testes Bun com harness isolado, 200 testes Jest aprovados (1 ignorado pré-existente) e build local aprovado.
- [x] Alterações registradas em commits locais; nenhuma migração de banco, push ou deploy executado.
- [ ] Plano completo ainda não encerrado: equivalência comportamental integral dos 144 contratos não demonstrada. Schema monetário das mensalidades remotas BetAI permanece pendência explícita, com fonte solicitada ao usuário.

## Continuação — dono de múltiplos produtos

- [x] Usuário confirmou alcance: todas as plataformas com histórico identificado, sem habilitação por tag. Implementação genérica existente atende regra; documentação de negócio atualizada.
- [x] Teste integrado de autorização, controller e projeção verifica dois produtos do mesmo dono: líquidos/saques separados, uma carteira compartilhada e histórico sem atribuição excluído de ambos.
- [x] Escopo `finance:read` e bloqueio de outro dono verificados. Sete testes dirigidos de saldo aprovados com banco sentinela e HTTP bloqueado.
- [ ] Pendências integrais dos 144 contratos e schema BetAI permanecem abertas.


## Continuação — retirada de mensalidades administrativas BetAI

- [x] Usuário determinou remoção dos oito aliases `/admin/betai/...`: upstream inexistente e sistema fora do ar. Controller, proxy e testes de transporte removidos; registros Nest eliminados.
- [x] Inventário original de 144 preservado para auditoria; oito contratos retirados, 136 ativos. Telemetria e checagem estrutural usam somente contratos ativos; documentação marca retirada sem substituição canônica.
- [x] Pendência de schema monetário BetAI encerrada por retirada explícita da capacidade, substituindo os registros anteriores dessa pendência.
- [x] Validação local: 477 testes Bun, 200 Jest (um ignorado pré-existente) e build aprovados. Jest exigiu setup temporário de cache de taxas com mock: execução padrão passou asserções, mas falhou por refresh assíncrono tardio contra banco sentinela loopback; repetição isolada encerrou com código zero.
- [ ] Equivalência comportamental integral dos 136 contratos restantes continua pendente.

## Continuação — equivalência e concorrência de manutenção

- [x] Quatro aliases Atlas/Revalida comparados com manutenção canônica: saldo líquido legado em reais, saldo bruto canônico em centavos, preservação de bloqueado e mesmos valores/CAS no lançamento.
- [x] Remover escape de manutenção no caminho `alreadyZero`; núcleo serializável revalida vínculo exclusivo mesmo sem mudança. Respostas passam a usar saldos transacionais, eliminando leitura anterior obsoleta.
- [x] Dez testes novos verificam equivalência, resposta sem mudança e concorrência; suíte Bun isolada completa passou com 547 testes.
- [x] Build local aprovado após regeneração local do cliente Prisma, desatualizado em relação aos modelos de ofertas já presentes no schema. Nenhuma migração executada.
- [ ] Equivalência integral dos demais contratos continua pendente. Arquivo SQL previamente staged pelo usuário preservado fora desta etapa.

## Continuação — contrato de e-mail VM Atlas

- [x] Alias de e-mail VM e capacidade canônica exercitam serviço real de montagem de template com SMTP substituído por mock. Destinatário, assunto, IP e senha são equivalentes; envelopes próprios preservados.
- [x] Três testes dirigidos aprovados: equivalência, falha SMTP propagada e capacidade indisponível em outra plataforma (422 estável). Escopo canônico `mail:send` verificado; nenhuma mensagem enviada.
- [ ] Equivalência integral dos demais contratos continua pendente; esta etapa acrescenta um contrato legado à cobertura comportamental.

## Continuação — equivalência financeira de saques corporativos

- [x] Seis aliases comparados com pedido canônico usando escritor real e persistência mockada: líquido, bruto, taxa, chave, status, adquirente e políticas históricas de reserva.
- [x] Corrigir taxa canônica Ebook/Pagatg para base líquida; regra de comerciante mantém base bruta. Escritor legado deixa de presumir DOM e valida cadastro/dono ativos na transação.
- [x] 25 testes dirigidos e 563 Bun da suíte completa aprovados; build local aprovado. Validação inclui bloqueio de plataforma inexistente/inativa sem lançamento.
- [ ] Cobertura comportamental das demais rotas segue em execução.

## Continuação — ciclo completo de vouchers Pagatg

- [x] Adicionar PATCH canônico de voucher, com centavos/taxa decimal, escopo `vouchers:write` e campos de identidade/canal rejeitados.
- [x] Cinco aliases exercitam VoucherService real com persistência mockada: criação, listagem, validação, atualização e exclusão. Valores, arredondamento, canal, propriedade e envelopes comparados; casos inválidos não escrevem.
- [x] Seis testes de ciclo de voucher e DTO/escopo adicional aprovados; suíte Bun com etapas atuais passou em 602 testes. Build local aprovado.

## Continuação — consultas financeiras e status de pagamentos

- [x] Consultas legadas exercitam projeções reais, valores não zerados e predicados Prisma avaliados no fixture: seis summaries/carteiras, cinco listagens de saques, quatro históricos, AreaFlix status/totais, Atlas health/status, Ebook configuração e Bosque inspeção/conciliação.
- [x] Corrigir busca por descrição Ebook para manter condição da plataforma; busca textual não pode substituir tag.
- [x] Seis aliases de status de pagamento comparados com lookup canônico: referências, estado normalizado, líquido/bruto em centavos, histórico do dono anterior, ausência/marca conflitante e plataforma inativa. Respostas legadas NOT_FOUND/PENDING/UNKNOWN e canônico 404 permanecem deliberadamente distintos.
- [x] 19 testes de leitura financeira e 14 de status aprovados; regressão completa de 602 Bun e build aprovados antes das etapas seguintes.

## Continuação — relatório de cliente por produto

- [x] Extrair dashboard de cliente para núcleo compartilhado; alias preserva seleção histórica, canônico exige contexto e histórico exclusivo do produto.
- [x] Adicionar `GET /platforms/:tag/reports/customer`, centavos, contagens preservadas e carteira explicitamente do dono. Cálculos monetários usam Decimal.
- [x] Três testes de contrato cobrem equivalência, isolamento e transferência. Suíte isolada: 612 testes Bun aprovados; build aprovado.

## Continuação — manutenção Bosque transacional

- [x] Baseline calculado dentro da transação serializável, limitado ao disponível atual; repetição sem saldo não lança nova baixa.
- [x] Delta de carteira aplica sobre saldo transacional e preserva bloqueado não informado. Compatibilidade mantém piso zero legado; canônico rejeita saldo negativo.
- [x] Adicionar operações canônicas admin `baseline` e `adjust-balance`, centavos inteiros e bloqueio de carteira compartilhada. Seis testes comportamentais aprovados; suíte isolada de 612 Bun aprovada.

## Continuação — atribuição estrita das consultas financeiras

- [x] Consultas canônicas excluem marcas conflitantes antes de paginação, contagem e somas; relatório usa Decimal.
- [x] Status válidos derivados do enum Prisma, incluindo CHARGEBACK e IN_MEDIATION. Regressão de 613 testes Bun aprovada. Build aprovado após remoção de condição redundante no relatório de cliente.
- [x] Espelhamento de planos aceita revalidação transacional de contexto canônico.

## Continuação — importação de planos e lançamentos

- [x] Importação canônica de plano Pagatg existente em `POST /platforms/:tag/subscriptions/plans/import`, com cents/DTO, sem criar assinatura remota. Mesmo escritor do alias, vínculo global protegido e contexto revalidado.
- [x] Dois contratos Ebook exercitam escritor real: pendência e comissão preservam referências, status, dados do comprador, parcelas e ausência de crédito à carteira. Comparação respeita precisão Decimal(12,2) persistida.
- [x] Testes dirigidos aprovados para importações e validação de DTO.
