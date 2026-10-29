# Saques DOM centralizados no administrador

O exportador da API DOM desativada foi removido. Este script mantém apenas a
importação de arquivo previamente revisado, sem consultar a API externa.
`--admin-email` identifica a conta local administradora, não o beneficiário do
saque. Execute somente contra banco explicitamente autorizado.

Para importar, faça conciliação com fonte confiável e atribua `userId`
**beneficiário** a cada saque. Exemplo de arquivo revisado:

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
