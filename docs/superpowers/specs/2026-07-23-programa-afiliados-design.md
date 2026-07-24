# Programa de Afiliados — Design

## Contexto

Simpay quer um programa de afiliados interno: contas selecionadas pelo master ganham
comissão percentual sobre a receita que a Simpay recebe (`platformFee`) das transações
das contas que elas trouxeram.

Diferente do Atlas (onde qualquer conta pode virar afiliado livremente), aqui o acesso
é fechado: só o master decide quem é afiliado e qual a % de comissão de cada um.

## Regras de negócio

1. Afiliado não é liberado por padrão — master ativa manualmente por conta.
2. Master define a % de comissão individualmente por afiliado (não é global).
3. Comissão incide sobre `Transaction.platformFee` (lucro da Simpay), não sobre o valor
   bruto pago pelo cliente final.
4. Escopo de receita: só `Transaction.platformFee`. Taxa de saque e outras fontes
   (PixCreditPlan, SubscriptionLink etc.) ficam fora por enquanto.
5. Comissão é creditada quando a transação vira `COMPLETED`, e revertida se depois virar
   `REFUNDED`/`CHARGEBACK`.
6. Cai direto em `Wallet.balance` (saldo sacável), mesmo fluxo de saque já existente.
7. Um nível só — sem cadeia de indicação (indicado de indicado não gera comissão).
8. Afiliado tem painel próprio (somente leitura: link, indicados, extrato de comissão).

## Modelo de dados

### `User` (campos novos)

- `isAffiliate Boolean @default(false)` — liga/desliga feito pelo master.
- `affiliateCommissionPercent Decimal? @db.Decimal(5,2)` — só relevante se `isAffiliate`.
- `affiliateCode String? @unique` — gerado quando o master ativa o afiliado; usado no
  link público de indicação (`/cadastro?ref=CODE`).
- `referredByUserId String?` — self-relation (`referredBy` / `referrals`) apontando pro
  afiliado que trouxe essa conta.

### `AffiliateCommission` (novo model)

Histórico/log de cada comissão gerada — alimenta painel do master e do afiliado, e é a
fonte de verdade para reversão.

```
id                String   @id @default(uuid())
affiliateUserId   String
referredUserId    String
transactionId     String   @unique
percentApplied    Decimal  @db.Decimal(5,2)
grossPlatformFee  Decimal  @db.Decimal(12,2)
commissionAmount  Decimal  @db.Decimal(12,2)
status            AffiliateCommissionStatus @default(CREDITED) // CREDITED | REVERSED
createdAt         DateTime @default(now())
reversedAt        DateTime?
```

`transactionId` único impede double-credit na mesma transação. Guardar o valor calculado
(não só a %) garante reversão exata mesmo que o master mude a % do afiliado depois.

### `Lead` (campo novo)

- `referredByCode String?` — capturado da query string `?ref=` no formulário público de
  cadastro, usado para vincular automaticamente na aprovação.

## Vínculo afiliado → indicado

Duas formas, não são exclusivas:

1. **Automático via link**: afiliado ativo tem `affiliateCode`. Link
   `https://simpay.../cadastro?ref=CODE` — form de Lead grava `ref` em
   `Lead.referredByCode`. Em `ApproveLeadUseCase`, se `referredByCode` bate com algum
   `User.affiliateCode`, o `User` recém-criado nasce com `referredByUserId` setado.
2. **Manual pelo master**: em qualquer conta (nova ou já existente), master pode
   setar/trocar `referredByUserId` a qualquer momento — tela de detalhe do usuário ganha
   campo "indicado por" editável. Override manual sempre disponível, mesmo se já tinha
   vínculo automático.

## Crédito de comissão

Hook nos pontos existentes de `process-dom-webhook.use-case.ts` (múltiplos branches, um
por adquirente/tenant) onde a transação transiciona pra `COMPLETED`:

1. Depois do crédito normal na wallet do dono da transação, checar
   `transaction.user.referredByUserId`.
2. Se o afiliado referenciado está com `isAffiliate=true`, calcular
   `commissionAmount = platformFee * (affiliateCommissionPercent / 100)`.
3. Creditar em `Wallet.balance` do afiliado — mesmo padrão já usado no arquivo
   (`wallet.updateMany` + `balanceLog.create`, novo `source: 'AFFILIATE_COMMISSION'`).
4. Gravar `AffiliateCommission` com status `CREDITED`, `percentApplied` e
   `commissionAmount` no valor efetivamente creditado (snapshot).

Nos pontos onde `COMPLETED → REFUNDED/CHARGEBACK` (mesmo arquivo):

1. Buscar `AffiliateCommission` da transação com status `CREDITED`.
2. Se existir, debitar o `commissionAmount` exato da wallet do afiliado.
3. Marcar `status = REVERSED`, `reversedAt = now()`.

Notas:
- % aplicada é sempre a vigente no momento do crédito (snapshot em `percentApplied`).
  Mudar a % do afiliado depois não retroage sobre comissões já creditadas.
- Se o afiliado for desativado (`isAffiliate=false`) depois de gerar comissões, o vínculo
  `referredByUserId` permanece — só comissões futuras param (checagem é feita no momento
  do crédito, não no vínculo).
- Como há múltiplos branches de conclusão no webhook (DOM principal, Frendz, Areaflix
  subcontas, Ebook etc.), o hook de crédito/reversão precisa ser inserido em cada um —
  idealmente via um helper compartilhado (`applyAffiliateCommission(tx, prismaTx)` /
  `reverseAffiliateCommission(tx, prismaTx)`) chamado de cada branch, pra não duplicar a
  lógica de cálculo.

## Painel Master (front-simpay)

Nova página `admin/afiliados`:
- Lista de usuários com toggle "é afiliado" + input de %.
- Busca/seleciona usuário (reusa listagem de `admin/usuarios`) pra ativar como afiliado.
- Tela de detalhe do afiliado: código/link de indicação, lista de contas indicadas, total
  de comissão gerada (soma `AffiliateCommission` com `CREDITED` menos `REVERSED`).

Em `admin/usuarios` (detalhe de qualquer conta): campo "indicado por" editável — override
manual do vínculo `referredByUserId`.

## Painel Afiliado (front-simpay)

Nova seção no dashboard do usuário, visível só se `isAffiliate=true`:
- Link/código de indicação próprio (com botão copiar).
- Lista de contas que ele trouxe (nome/email, data de vínculo).
- Extrato de comissões: valor, transação de origem, data, status (creditada/revertida).
- Total ganho acumulado.

Somente leitura — afiliado não vê % de outros afiliados nem edita nada.

## Fora de escopo (não fazer agora)

- Comissão multinível (indicado de indicado).
- Comissão sobre taxa de saque ou outras fontes de receita além de `Transaction.platformFee`.
- Retenção em `lockedBalance` com liberação manual — cai direto em `balance`.
- Qualquer forma de auto-cadastro como afiliado (sempre curadoria do master).
- Comissão retroativa em transações criadas por ferramentas de backfill/sync em lote do
  admin (`backfill-comunidade`, `sync-full-bosque/ebook/renovada`, `sync-maquinetas`).
  Essas rotas lidam com dados históricos — gerar comissão de afiliado sobre uma
  transação que já aconteceu antes do vínculo existir não faz sentido de negócio.
  A comissão só é gerada no caminho ao vivo (webhook), coberto pelos hooks em
  `process-dom-webhook.use-case.ts` e `process-webhook.use-case.ts` (incluindo o
  caminho de `SubscriptionLinkOrder`, fechado na Task 9 do plano de implementação).
