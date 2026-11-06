# Recuperação a partir das transações

## Execução

Use uma cópia local restaurada do banco primeiro. `DATABASE_URL` escolhe a conexão;
`--database-name` deve coincidir com o nome nessa URL. Não imprime credenciais.
Sem `--dom`, nenhuma consulta externa é feita. Com `--dom`, script faz apenas GET
em detalhes de transações DOM já importadas. Não importa novas transações.

Script imprime host, porta e banco sem credenciais e valida conexão antes de
recuperar registros. `ECONNREFUSED` indica conexão recusada nesse endereço:
confira serviço PostgreSQL, porta publicada, VPN/túnel e `DATABASE_URL`.
`--database-name` apenas confere nome; não troca host nem inicia PostgreSQL.

```sh
bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO
bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO --apply
```

Para consultar DOM e completar **apenas campos locais vazios** das transações:

```sh
bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO --dom
bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO --dom --apply
```

Requer `DOM_TOKEN`. Compara ID DOM da resposta ao ID
local; só aceita líquido se bruto da resposta for igual ao bruto local em reais
ou centavos. Não altera status, bruto nem dados já preenchidos. Falhas DOM são
contadas em `domErrors`; revise antes de aplicar. Faz uma consulta por transação
incompleta, o que pode demorar em histórico grande.

Para recuperar contas de cadastro comprovado no `pg_dump` local, ou leads locais
aprovados vinculados a `approvedUserId`:

```sh
RECOVERY_INITIAL_PASSWORD='SENHA_ESCOLHIDA' bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO --backup-file=backup.sql
RECOVERY_INITIAL_PASSWORD='SENHA_ESCOLHIDA' bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO --backup-file=backup.sql --dom --apply
```

Use a senha fornecida pelo operador na variável de ambiente. Ela é armazenada
como hash bcrypt, nunca impressa ou enviada à DOM. Backup é **lido como texto**;
script não executa SQL, não restaura sessões, tokens ou senhas antigas. Contas
ADMIN e inativas são deixadas para recuperação individual. IDs, e-mails e
documentos conflitantes são pulados ou abortam a operação. Cada e-mail criado
é impresso em `createdEmail`; resumo final contém `createdEmails`. A lista aparece
também em execução interrompida, para as contas criadas até aquele momento.

Sem `--apply`, apenas leitura e relatório JSON. Com `--apply`, cria compradores
com documento, nome e e-mail completos; donos externos identificados por tags;
vínculos por documento com contas existentes; carteiras ausentes com saldo zero.
Cadastros existentes são preservados. Donos excluídos/inativos não são reativados.
Dados incompletos são contabilizados, sem inventar CPF, e-mail ou senha.
Tags reconhecidas: EBOOK/EBOOKSIM, RENOVADA, REVALIDA, BOSQUE, PAGATG, FRENDZ e ATLAS.

Criações usam `skipDuplicates`. Interrupção pode deixar parte dos cadastros criada;
nova execução completa os restantes. Não há exclusões nem incrementos de receita.
Execute com aplicação e outros escritores parados para obter leitura consistente.

## Saldos

Relatório financeiro mostra líquido conhecido, transações sem líquido, saques
aprovados/concluídos e pendentes por **usuário e plataforma**, saques sem plataforma
e cobranças não alocadas. Usa Decimal; líquido ausente não recebe valor bruto como
substituto. Saldo negativo não é truncado. Esse relatório não é saldo sacável.

Transações importadas podem ter líquido estimado com taxas atuais. Histórico de
saques perdido, ajustes manuais, comissões, expurgos e cobranças impedem reconstrução
automática confiável. Carteiras existentes e seus bloqueios são preservados.
Carteiras externas novas também ficam em zero, aguardando conciliação.

Para carteira principal de um **cliente específico**, obtenha o `User.id` e
aplique valores **já conciliados**. A lista pode ter uma única conta:

```json
[
  {
    "userId": "UUID_DA_CONTA",
    "expectedBalance": "0.00",
    "expectedLockedBalance": "0.00",
    "balance": "123.45",
    "lockedBalance": "20.00"
  }
]
```

```sh
bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO --balances-file=saldos-revisados.json
bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO --balances-file=saldos-revisados.json --apply
```

Para carteira inexistente de User já existente, use `expectedBalance` e
`expectedLockedBalance` iguais a `"0.00"`; script cria carteira com saldos
revisados e registra BalanceLog. Para carteira existente, valores esperados
devem corresponder ao estado atual. Valores são
strings com duas casas decimais. Arquivo contém saldo total e bloqueado, não apenas
disponível. Revisão deve respeitar convenção financeira específica de cada módulo.
Todos os saldos do arquivo são aplicados numa transação serializável; conflito de
valor anterior ou versão reverte esse lote. Valores já aplicados são ignorados.
Cada mudança registra `RECOVERY_REVIEWED_BALANCE` em BalanceLog. Cadastros criados
antes desse lote não são revertidos caso aplicação de saldos falhe.

## Limites

Não inventa contas User a partir de e-mail de comprador, plataformas,
links, planos, assinaturas, permissões,
histórico fictício de status ou saldos externos por inferência. Transaction não
contém configuração suficiente para recriar esses registros com segurança.
Plataforma recuperada significa associação em ExternalPlatformUser, não criação
de módulo/configuração de taxas. Nome/documento de comprador não identifica vendedor.

Relatório contém IDs e saldos revisados; trate saída como dado financeiro privado.
Antes de aplicação, mantenha backup do banco. Teste unitário local:

```sh
bun test scripts/recover-from-transactions.test.ts
```
