# Recuperação a partir das transações

## Execução

Use uma cópia local restaurada do banco primeiro. `DATABASE_URL` escolhe a conexão;
`--database-name` deve coincidir com o nome nessa URL. Não imprime credenciais.
Nenhuma consulta à DOM, CPF, webhook, e-mail ou outro serviço externo é feita.

Script imprime host, porta e banco sem credenciais e valida conexão antes de
recuperar registros. `ECONNREFUSED` indica conexão recusada nesse endereço:
confira serviço PostgreSQL, porta publicada, VPN/túnel e `DATABASE_URL`.
`--database-name` apenas confere nome; não troca host nem inicia PostgreSQL.

```sh
bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO
bun scripts/recover-from-transactions.ts --database-name=NOME_DO_BANCO --apply
```

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

Para carteira principal, aplicação opcional de valores **já conciliados**:

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

Execute recuperação de cadastros antes, caso carteira não exista. Valores são
strings com duas casas decimais. Arquivo contém saldo total e bloqueado, não apenas
disponível. Revisão deve respeitar convenção financeira específica de cada módulo.
Todos os saldos do arquivo são aplicados numa transação serializável; conflito de
valor anterior ou versão reverte esse lote. Valores já aplicados são ignorados.
Cada mudança registra `RECOVERY_REVIEWED_BALANCE` em BalanceLog. Cadastros criados
antes desse lote não são revertidos caso aplicação de saldos falhe.

## Limites

Não cria contas User, módulos TenantModule, links, planos, assinaturas, permissões,
histórico fictício de status ou saldos externos por inferência. Transaction não
contém configuração suficiente para recriar esses registros com segurança.
Plataforma recuperada significa associação em ExternalPlatformUser, não criação
de módulo/configuração de taxas. Nome/documento de comprador não identifica vendedor.

Relatório contém IDs e saldos revisados; trate saída como dado financeiro privado.
Antes de aplicação, mantenha backup do banco. Teste unitário local:

```sh
bun test scripts/recover-from-transactions.test.ts
```
