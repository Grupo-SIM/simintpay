# Unificar rotas e serviços de plataformas

Plano aprovado pelo usuário. Execução exclusivamente local; banco externo, push e deploy proibidos.

## Progresso

- [x] Caracterizar contratos legados: `docs/legacy-platform-routes.md` inventaria rotas, autenticação, entradas, saídas, status, unidades e SSE.
- [x] Resolver cadastro/dono ativo no banco; separar credenciais por plataforma/operação; reservar tags corporativas ao admin.
- [x] Implementar núcleo financeiro e APIs canônicas em centavos, com relatórios por marca explícita e carteira por usuário.
- [x] Extrair contratos financeiros legados em serviços; controllers delegam sem redirects/HTTP interno.
- [x] Compartilhar barramento SSE; centralizar agendamento corporativo e impedir execução concorrente por plataforma.
- [x] Exigir associação explícita da comunidade Return Bet; ausência bloqueia capacidade com 422.
- [ ] Concluir pagamentos/adapters e comerciantes, preservando contratos corporativos.
- [ ] Concluir entrada compartilhada de webhooks e validação/idempotência.
- [ ] Validar equivalência, isolamento, credenciais, adquirentes e concorrência com mocks.
- [ ] Build local e commits pelos hooks; registrar limitações verificadas.

## Evidências

Inventário obtido de HEAD antes da substituição dos controllers. Nenhuma configuração/token inferida ou banco externo alterado. Núcleo usa modelos existentes sem migração.
