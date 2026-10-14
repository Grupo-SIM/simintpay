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

Inventário obtido de HEAD antes da substituição dos controllers. Nenhuma configuração/token inferida ou banco externo alterado. Núcleo usa modelos existentes sem migração.

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

- Unificar a execução financeira dos contratos legados de pagamento com a operação canônica, preservando respostas específicas de cada adapter.
- Reduzir consultas/projeções duplicadas nos adapters financeiros legados; migrar espelhamento/registro de transações PAGATG e demais capacidades corporativas ainda atendidas somente pelos contratos existentes.
- Completar testes de equivalência de todos os 144 contratos inventariados (cobertura atual dirigida, sem equivalência exaustiva).
- Validar contratos corporativos restantes de checkout/callbacks sem executar serviços externos.

Nenhum desses itens é tratado como concluído pela existência da nova rota. Implementação segue parcial quanto à migração integral dos aliases; endpoints existentes continuam atendidos. Nenhum banco externo, deploy ou push foi executado.
