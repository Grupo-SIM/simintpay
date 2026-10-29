# Plataformas explícitas, donos e configuração no banco

## Decisões

Cadastro explícito com dono obrigatório. Usuário cria plataforma própria; admin pode atribuir/transferir. Donos atuais comprovados preservados; Grupo SIM (`01a122a5-4743-7562-8f01-c84182eaafd1`) recebe pendências. Taxas SimIntPay admin-only; juros por parcela ao cliente configuráveis por plataforma. Prejuízo permitido com aviso individual. URLs/tokens específicos no banco, tokens cifrados. Preservar regra de liquidez do saque e cobrança efetiva na migração. Não alterar lançamentos/saldos históricos.

## Etapas

- [x] Cadastro, permissões e registro explícito de plataformas.
- [x] Resolvedor financeiro único; separar custos e juros do cliente.
- [x] Integrações no banco; eliminar usuários e donos automáticos.
- [x] Inventário e migração idempotente, com validação antes/depois.
- [x] Testes, documentação e commit local.

## Limites

Backend NestJS/Prisma existente. Sem push/deploy. Banco alterado somente para migração autorizada desta tarefa. Tokens nunca em relatórios/logs. Operações financeiras e integrações externas não executadas pela migração.

## Resultado

Migração aplicada em 2026-10-13: 14 plataformas, donos Bosque/Atlas preservados, demais pendências atribuídas ao Grupo SIM. Sete contas técnicas desativadas; totais financeiros preservados. Reexecução e leitura de credenciais cifradas verificadas. Variáveis antigas retiradas de .env local e Compose; chave de criptografia permanece protegida fora do Git.

Cadastro, custos, juros, integrações, autenticação e seleção explícita implementados. Carteiras continuam por usuário; manutenção exclusiva de plataforma bloqueada para donos compartilhados. APIs e limitações descritas em docs/business-rules.md.

Validação: build Nest; 58 testes Bun em 16 arquivos; 152 testes Jest em 34 suítes. Sem push/deploy. Produção precisa receber código e mesma PLATFORM_CONFIG_ENCRYPTION_KEY; frontend administrativo deve consumir novas APIs.
