# Saques DOM centralizados no administrador

Use `DOM_TOKEN` ou `API_DOM_MASTER_KEY` já presentes em `.env` conforme token
que consulta `/payments/withdrawals`. Não copie valor do token para o comando
ou arquivo. `--admin-email` identifica a conta local administradora, não o
beneficiário do saque.

```sh
bun scripts/recover-dom-withdrawals.ts \
  --database-name=simpay --admin-email=adminljl@simpay.com.br \
  --token-env=DOM_TOKEN --output=saques-dom.json
```

Exportação consulta DOM por GET e banco por SELECT. Arquivo novo usa permissão
`0600`; script não sobrescreve arquivo existente. `rawValue` e `rawStatus`
preservam resposta DOM sem assumir unidade monetária ou taxa. `existing` mostra
o vínculo local quando `domWithdrawId` já existe.

DOM não informa a qual cliente SimIntPay pertence cada repasse. Para importar,
faça conciliação e atribua `userId` **beneficiário** a cada saque. Exemplo de
arquivo revisado:

```json
{
  "adminUserId": "UUID_DO_ADMIN_DA_EXPORTACAO",
  "withdraws": [
    {
      "userId": "UUID_DO_CLIENTE_BENEFICIARIO",
      "domWithdrawId": "ID_DOM",
      "status": "COMPLETED",
      "amount": "98.00",
      "grossAmount": "100.00",
      "fee": "2.00",
      "pixKey": "CHAVE_PIX",
      "createdAt": "2026-09-20T00:00:00.000Z",
      "platform": "ebook"
    }
  ]
}
```

Confirme unidade, taxa, líquido, bruto, status e destinatário em fonte
confiável. `grossAmount = amount + fee` é obrigatório. Saque sem destinatário
comprovado fica apenas no relatório. ID DOM existente com outro beneficiário ou
valor causa erro; nenhum registro existente é sobrescrito. Importação inteira
usa transação serializável. Carteiras e BalanceLog não mudam; concilie saldos
depois, contando saques uma vez.

```sh
bun scripts/recover-dom-withdrawals.ts \
  --database-name=simpay --admin-email=adminljl@simpay.com.br \
  --apply-file=saques-revisados.json
```

Arquivos contêm chave PIX e valores financeiros. Guarde em local privado;
não comite.

## Certificados TLS

HTTPS usa certificados raiz do runtime. Para CA privada ou proxy corporativo,
adicione certificado CA PEM obtido de fonte confiável:

```sh
DOM_CA_FILE=/caminho/ca-confiavel.pem bun scripts/recover-dom-withdrawals.ts \
  --database-name=simpay --admin-email=adminljl@simpay.com.br \
  --token-env=DOM_TOKEN --output=saques-dom.json
```

Verificação TLS permanece ativa. Se servidor não apresentar cadeia completa,
corrija configuração TLS do servidor. Não use certificado obtido da conexão
que falhou como raiz confiável sem verificar sua origem.
