# Rebase e integração das mudanças remotas

Execução local aprovada. Sem fetch, push, banco externo ou deploy.

## Referências

- Backup: `backup/pre-remote-rebase-20261014`, HEAD `2cf37f2e04bf38d1007e6cb9ed885a6d3a0233c8`.
- Remoto analisado: `origin/main`, `2ceaa057abc233f333752fe9fa567674a331e418`.
- Base comum: `470f09a05878271c8ab19d1e42e3174e6add0079`; 36 commits locais.

## Etapas

- [x] Ler plano 0003, verificar árvore limpa e criar backup local.
- [x] Reaplicar commits e resolver conflitos preservando núcleo compartilhado.
- [x] Integrar classificação, filtros e afiliados.
- [x] Integrar taxas, marcador FINAL_NET e liquidação atômica sem alterar histórico.
- [x] Adaptar consultas externas à configuração explícita criptografada, isolamento e limites.
- [ ] Testar com mocks, verificar migrations localmente, build e range-diff; concluir com árvore limpa.

## Regras confirmadas

Links novos sem descontos adicionais de cashback/fixa; juros do comprador permanecem receita da plataforma. Defaults: 9% e saque R$ 3,50; override zero válido. Histórico, dono e isolamento preservados. Consulta externa somente leitura, sem inferência de dono por e-mail; estados unconfigured/unavailable explícitos.

## Rebase e administração

37 commits reaplicados (36 originais e registro deste plano). Conflitos resolvidos em Compose, taxas, providers administrativos e cron. Referência remota inteira ancestral do HEAD; núcleo Platform/scheduler e retirada BetAI preservados. Classificação booleana validada; filtros executados antes de paginação; onlyMine testado nos cinco produtos. Projeções administrativas usam PlatformAttributedBalance, produtos explícitos e carteira compartilhada separada; baseline Bosque mantido pelo adapter existente.

## Liquidação e taxas

FINAL_NET nullable com CHECK aditivo, sem backfill. Draft persistido antes do gateway; referência explícita permite callback antes da resposta. Escritor comum aplica CAS, saldo, histórico e comissão atomicamente em resposta/webhook/polling. Snapshot e dono não são reescritos; estorno consulta crédito auditado, fallback legado preservado. PIX/débito mantêm regras próprias; matriz de 1–12 parcelas, juros, absorção, override zero e rollback cobertos. Resumo usa balance − lockedBalance, inclusive Bosque/Renovada.

Migration remota de classificação preservada byte a byte. Ambas migrations aplicadas em PostgreSQL 18 descartável via socket /tmp, sem rede: histórico manteve líquido e base NULL; classificação default false; marcador inválido rejeitado. Servidor local encerrado após teste. Regressão anterior: 510 Bun e 206 Jest aprovados (um ignorado preexistente); checks finais seguem na última etapa.

## Leitura externa

URLs migradas do exemplo de ambiente para segredo EXTERNAL_DATABASE_URL em PlatformIntegration. Configuração restrita ao admin, protocolo PostgreSQL validado e segredo mascarado. Cadastro/configuração ativos obrigatórios; slug inválido 400; estados available/unconfigured/unavailable. Pools de dois clientes com transação somente leitura e limites de 5s; renovação e fechamento verificados com mocks. Fixtures cobrem classificação das seis fontes e falha parcial, sem consultas reais.

Durante execução outra ferramenta atualizou origin/main para b670f6c3fcabb8da1df776cb807672513ebba323 (campo organizationName de Patrimonial). Nenhum fetch executado nesta tarefa. Commit adicional incorporado por rebase local; organizationName preservado e testado, sem mudar classificação ou identidade financeira.

## Detalhes de afiliados

Campos remotos grossTotal/purchases preservados com defaults compatíveis. Caminho local consulta apenas IDs dos indicados do afiliado selecionado e vendas COMPLETED, mantendo generated e comissão por transação desse afiliado. Lista vazia de indicados não dispara consulta financeira sem escopo. Dois testes Jest caracterizam compras/total bruto e isolamento.
