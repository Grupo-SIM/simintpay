# Listagem de transações no ledger multiadquirente

## Resumo da mudança

`GET /transacoes` é a fonte da tela de transações. A rota consulta somente o ledger local (`Transaction`), sincronizado previamente por cron e webhooks; ela nunca chama uma adquirente durante a listagem.

Consequências para a tela:

- a lista contém registros locais de todas as adquirentes;
- uma transação recém-criada ou alterada aparece depois da sincronização do ledger, não imediatamente;
- paginação e `total` são calculados no banco local e permanecem consistentes entre páginas;
- o item não tem mais o formato da resposta da DOM. Agora usa os campos camelCase e os enums internos da entidade `Transaction`.

## Requisição

```http
GET /transacoes?page=1&limit=50&begin_date=2026-08-01&end_date=2026-08-17&status=COMPLETED&payment_method=CREDIT_CARD&acquirer=DOM
```

| Parâmetro | Regra atual |
| --- | --- |
| `page` | Opcional. Inteiro a partir de `1`; padrão `1`. |
| `limit` | Opcional. Inteiro de `1` a `100`; padrão `50`. |
| `begin_date` | Opcional. `YYYY-MM-DD`; inclui o início do dia no fuso `America/Sao_Paulo`. |
| `end_date` | Opcional. `YYYY-MM-DD`; inclui o fim do dia no fuso `America/Sao_Paulo`. |
| `status` | Opcional. Envie o enum interno em maiúsculas: `DRAFT`, `PENDING`, `COMPLETED`, `FAILED`, `REFUNDED`, `EXPIRED`, `IN_MEDIATION`, `CHARGEBACK` ou `PENDING_REFUND`. |
| `payment_method` | Opcional. Enum interno: `PIX`, `CREDIT_CARD`, `DEBIT_CARD` ou `BOLETO`. |
| `acquirer` | Opcional. Enum interno: `DOM` ou `FRENDZ`. |
| `q` | Opcional. Busca ID, IDs externos e descrição. |

Sem intervalo de datas, a rota lista todo o histórico presente no ledger. Isto substitui o comportamento anterior, que solicitava os últimos 90 dias à DOM.

Admin recebe todo o ledger; usuário comum recebe somente as próprias transações e o escopo de tenant já atribuído a ele.

`GET /admin/transacoes-dom` permanece como endpoint legado para consumidores DOM específicos. Ele filtra `acquirer = DOM`; fluxos novos devem usar `/transacoes?acquirer=DOM`.

## Detalhe

```http
GET /transacoes/{id}
```

`id` aceita exclusivamente o UUID interno do ledger (`Transaction.id`). A rota localiza o registro primeiro e só então usa os identificadores externos persistidos para consultar a adquirente correspondente. Não passe `domTransactionId`, `domPaymentId` nem qualquer ID da adquirente na URL.

## Resposta

```json
{
  "data": {
    "transactions": [
      {
        "id": "0d4e4dc9-2bcd-4ef0-ae71-5bbdd06cd138",
        "userId": "6fa95916-2733-484e-8f28-25c9a9b1f6af",
        "amount": "149.90",
        "netAmount": "136.41",
        "status": "COMPLETED",
        "previousStatus": "PENDING",
        "paymentMethod": "PIX",
        "description": "Pedido #1234",
        "installments": 1,
        "totalFee": "13.49",
        "domFee": "2.99",
        "platformFee": "10.50",
        "domTransactionId": "id-da-transacao-na-dom",
        "domPaymentId": "id-do-pagamento-na-dom",
        "acquirer": "DOM",
        "externalTransactionId": null,
        "externalPaymentId": null,
        "pixQrCode": null,
        "pixContent": null,
        "pixExpire": "2026-08-17T18:00:00.000Z",
        "cardBrand": null,
        "cardBin": null,
        "cardCodeAuth": null,
        "customerName": "Nome do cliente",
        "customerEmail": "cliente@exemplo.com",
        "customerDocument": "00000000000",
        "customerPhone": "+5500000000000",
        "paymentLinkId": null,
        "createdAt": "2026-08-17T15:30:00.000Z",
        "updatedAt": "2026-08-17T15:31:00.000Z"
      }
    ],
    "total": 1
  }
}
```

Valores `Decimal` do Prisma devem ser tratados como valores monetários decimais — não como centavos. Preserve-os como `string` no tipo de transporte e converta somente na rotina de formatação/cálculo já adotada pelo frontend. Campos opcionais podem vir como `null`.

Ordenação fixa: `createdAt DESC`.

## Mapeamento do contrato anterior

| Formato anterior, vindo da DOM | Formato atual, vindo do ledger | Ação no frontend |
| --- | --- | --- |
| `created_at` | `createdAt` | Trocar chave; data vem em ISO 8601. |
| `updated_at` | `updatedAt` | Trocar chave; data vem em ISO 8601. |
| `cod_external` | `id`, `domTransactionId` ou `domPaymentId` | Usar `id` como chave React. Exibir ID DOM somente quando necessário e disponível. |
| `status` com `paid` | `status` com `COMPLETED` | Atualizar labels, cores e filtros para enum interno. |
| `status_details` | Não retornado | Derivar rótulo da tradução do enum `status`. |
| `payment_method` | `paymentMethod` | Trocar chave e normalizar enum (`PIX`, `CREDIT_CARD`, `DEBIT_CARD`, `BOLETO`). |
| `amount` | `amount` | Campo preservado; tratar como decimal. |
| `liquid_amount` | `netAmount` | Trocar chave; pode ser `null`. |
| `product_first` | `description` | Trocar fonte de texto; pode ser `null`. |
| `customer_*` em snake_case | `customerName`, `customerEmail`, `customerDocument`, `customerPhone` | Trocar chaves. |
| `card_*` em snake_case | `cardBrand`, `cardBin`, `cardCodeAuth` | Trocar chaves. |
| `pix_qrcode`, `pix_content`, `pix_expire` | `pixQrCode`, `pixContent`, `pixExpire` | Trocar chaves. |
| `fee_total`, `taxa_dom`, `taxa_vendedor`, `taxa_fixa_transacao`, `taxa_cashback`, `valor_liquido_vendedor`, `lucro_master`, `tenant_tag` | Não retornados | Remover da tabela, ou aguardar endpoint específico que forneça cálculo consolidado. Não recalcular silenciosamente com regras antigas. |

`type_operation`, `boleto_url`, `boleto_digitable_line` e `customer_birthdate` também não fazem parte da resposta atual.

## Tipos sugeridos

```ts
type TransactionStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'IN_MEDIATION'
  | 'CHARGEBACK'
  | 'PENDING_REFUND';

type PaymentMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';

interface Transaction {
  id: string;
  amount: string;
  netAmount: string | null;
  status: TransactionStatus;
  paymentMethod: PaymentMethod;
  description: string | null;
  installments: number;
  domTransactionId: string | null;
  domPaymentId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerDocument: string | null;
  customerPhone: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TransactionsResponse {
  data: {
    transactions: Transaction[];
    total: number;
  };
}
```

Inclua os campos de cartão, PIX e taxas no tipo caso a tela os exiba. O tipo acima contém a base para a lista.

## Checklist de implementação

1. Usar `GET /transacoes`; atualizar leitura para `response.data.transactions` e total para `response.data.total`.
2. Calcular paginação com o `limit` enviado e `total`; não usar total da DOM.
3. Trocar todas as chaves snake_case pelas chaves camelCase da tabela acima.
4. Substituir o filtro/label `paid` por `COMPLETED`.
5. Mostrar estados de carregamento e vazio distintos: lista vazia agora pode significar ledger ainda não sincronizado.
6. Remover colunas dependentes dos cálculos que não fazem mais parte deste endpoint.
7. Não exibir QR code, payload PIX, documento, e-mail ou telefone na tabela principal sem necessidade; são dados pessoais/sensíveis. Carregar ou revelar somente em detalhe autorizado.

## Validação manual

```bash
curl -sS 'http://localhost:3001/transacoes?page=1&limit=20&status=COMPLETED&payment_method=PIX&acquirer=DOM'
```

Confirmar antes da entrega da tela:

- resposta contém `data.transactions` e `data.total`;
- uma linha `COMPLETED` exibe valor, método e data corretamente;
- filtros de data incluem transações no último dia escolhido;
- a segunda página não repete itens da primeira;
- registros ainda não sincronizados não são apresentados como falha da busca.
