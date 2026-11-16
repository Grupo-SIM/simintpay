# SQL das Fases 5 e 6 do plano 0023

SQL **revisável e manual**, fora de `prisma/migrations` de propósito: o deploy roda `prisma migrate deploy` sozinho e estas fases não podem ir junto. Nada aqui é aplicado por código. Quem executa é o dono, com `psql`, depois da autorização de cada fase.

## Ordem de execução

| #   | Quando                                                                                                                     | O quê                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0   | Fases 2 a 4 concluídas (ofertas copiadas, delta copiado, links legados congelados, escritores cortados); backup/PITR feito | `bun scripts/offer-parity-check.ts --database-url=...` sem divergência   |
| 1   | Fase 5                                                                                                                     | `phase5-repoint-and-rename.sql` (ensaio, depois `-v finish=COMMIT`)      |
| -   | Observação de 2 a 4 semanas                                                                                                | webhooks sem correspondência, relatórios, 404 de URL antiga              |
| -   | Se algo der errado antes da Fase 6                                                                                         | `phase5-rollback.sql`                                                    |
| 2   | Fase 6, com o código classe C removido                                                                                     | `phase6-drop.sql` (ensaio, depois `-v finish=COMMIT`)                    |
| 3   | Junto do release do código da Fase 6 (migration normal do Prisma, não está aqui)                                           | `Offer.legacyType/legacyId`, CHECK `CoproductionAgreement_product_check` |

```sh
# Fase 5: ensaio (termina em ROLLBACK) e aplicação
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/phase-sql/phase5-repoint-and-rename.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v finish=COMMIT -f prisma/phase-sql/phase5-repoint-and-rename.sql

# Fase 6: exige digitar o nome do banco; tabelas legadas com linhas exigem accept_loss
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm="DROP-LEGACY:<nome do banco>" -f prisma/phase-sql/phase6-drop.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm="DROP-LEGACY:<nome do banco>" \
  -v accept_loss=PaymentLinkOfferSale_legacy,SubscriptionLinkOrder_legacy -v finish=COMMIT \
  -f prisma/phase-sql/phase6-drop.sql
```

Todo script é uma transação só; qualquer pré-checagem que falhe acumula os problemas, aborta e não deixa nada pela metade. O padrão é **ROLLBACK** (ensaio): só `-v finish=COMMIT` grava. Requer `psql` 13+.

## O que cada um faz

- **Fase 5** solta `Transaction_paymentLinkId_fkey` (para `PaymentLink`) e cria a nova para `Offer` (`NOT VALID` + `VALIDATE`, mesma semântica `ON UPDATE CASCADE ON DELETE SET NULL`). Renomeia as 16 tabelas de produto para `..._legacy` (as FKs entre elas acompanham o rename). Pré-checagens: toda linha antiga tem `Offer` de mesmo id, sem colisão de id, sem órfão de `paymentLinkId`, `offerId` igual a `paymentLinkId`, `ExternalRef` da DOM para cada `domPaymentLinkId`/`domPlanId`, coprodução sem chave antiga, produtos legados inativos (`-v allow_active=1` aceita), funil/arquivos/assinaturas vivas/acesso PIX sem destino, nenhuma função ou view citando as tabelas.
- **Fase 6** apaga na ordem folha-primeiro da seção 8 (funil e arquivos, plano PIX, plano/assinatura DOM, link de assinatura, coluna `Transaction.paymentLinkId`, `PaymentLink`, `Boleto`) e o enum `PlanType`. Sem `CASCADE`, `DELETE` ou `TRUNCATE`. `Voucher`/`VoucherUsage` ficam (cupons foram portados e não têm FK para produto).

Por que só `Transaction.paymentLinkId` é repontada: é a única FK de tabela que sobrevive. As demais (`PaymentLinkFile`, `PaymentLinkOffer`, `PixPlanOrder`, `Subscription`, `SubscriptionLinkOrder` etc.) ligam tabelas que viram `_legacy` juntas e caem juntas; apontá-las para `Offer` faria um `RESTRICT`/`CASCADE` de dado morto travar ou apagar oferta viva.

## Rollback

- **Fase 5:** `phase5-rollback.sql` devolve os nomes e a FK para `PaymentLink` (também ensaio por padrão). Aborta se houver `Transaction.paymentLinkId` que só existe em `Offer` (venda posterior ao corte). O código precisa voltar a ler as tabelas antigas.
- **Fase 6:** irreversível depois do `COMMIT`; só restaurando backup/PITR. Antes do `COMMIT` o rollback é o próprio ensaio.

## Pré-requisitos que o SQL não cobre

- Nenhum código lê as tabelas renomeadas (o `RENAME` quebra qualquer `prisma.paymentLink`...). Faça o release do código da Fase 4/5 antes, ou na mesma janela.
- O `schema.prisma` ainda descreve `PaymentLink` e a relação `Transaction.paymentLink`; ele é ajustado junto do release de código, não aqui.
- Os nomes de índices e constraints das tabelas renomeadas não mudam (`Plan_pkey` etc.); a Fase 6 apaga tudo, então não é preciso renomear.

## Ensaio local (sem banco real)

`tests/rehearse.sh` sobe cenários em Postgres **local descartável** (recusa host que não seja `127.0.0.1`/`localhost`): cria `phase_template` com `prisma migrate deploy`, semeia `tests/seed-fixture.sql` (banco precisa se chamar `phase_*`) e confere caminho feliz, rollback, reaplicação e cada pré-checagem.

```sh
ADMIN_URL=postgresql://postgres@127.0.0.1:5432/postgres bash prisma/phase-sql/tests/rehearse.sh
```
