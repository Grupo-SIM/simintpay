# Unificar rotas e serviços de plataformas

Plano aprovado pelo usuário. Execução exclusivamente local; banco externo, push e deploy proibidos.

## Progresso

- [x] Caracterizar contratos legados: `docs/legacy-platform-routes.md` inventaria rotas, autenticação, entradas, saídas, status, unidades e SSE.
- [x] Resolver cadastro/dono ativo no banco; separar credenciais por plataforma/operação; reservar tags corporativas ao admin.
- [x] Implementar núcleo financeiro e APIs canônicas em centavos, com relatórios por marca explícita e carteira por usuário.
- [x] Extrair contratos financeiros legados em serviços; controllers delegam sem redirects/HTTP interno.
- [x] Compartilhar barramento SSE; centralizar agendamento corporativo e impedir execução concorrente por plataforma.
- [x] Exigir associação explícita da comunidade Return Bet; ausência bloqueia capacidade com 422.
- [x] Núcleo PIX DOM/Frendz e comerciantes explícitos; core legado compartilhado para Atlas/Bosque/Renovada/Zero Grau. Cartão canônico indisponível (422), contratos de cartão legados preservados.
- [x] Entrada canônica de webhook assinada; comparação atômica de status evita crédito duplicado e preserva dono histórico.
- [x] Validação dirigida com mocks: 50 testes Bun + 45 regressões Jest (+ 5 testes de cartão legado Zero Grau) aprovados.
- [x] Builds locais aprovados; commits locais com identidade Git configurada e trailer Codex.

## Evidências

Inventário obtido de HEAD antes da substituição dos controllers. Nenhuma configuração/token inferida ou banco externo alterado. Núcleo usa modelos existentes sem migração.

## Limites verificados desta implementação

- Contratos corporativos financeiros continuam em adapters específicos, inclusive consultas e projeções próprias. Nem todos os 144 contratos inventariados têm teste de equivalência alias/canônico.
- PIX canônico implementado; cartão canônico, manutenção mutável canônica e migração completa das capacidades SaaS/Pagatg/BetAI ao dispatcher ainda pendentes. Endpoints existentes permanecem ativos.
- Nenhum hook Git ativo encontrado neste checkout (somente arquivos `.sample`); commits normais não contornam hooks.
