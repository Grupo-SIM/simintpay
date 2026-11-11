# Transaction platform tag (single source of truth)

`Transaction.platformTag` decides which platform a transaction belongs to. It is the only thing readers
may use for filtering, grouping, ownership and report totals.

## Lifecycle

- Seeded from the `[TENANT:x]` marker of the description: by the backfill in migration
  `20261029120000_transaction_platform_tag` and by its BEFORE INSERT trigger when an insert provides no tag.
- Writers that already know the platform also pass it explicitly on create
  (`transactionPlatformTagData(tag)`); the description marker is still written for compatibility.
- After that it is a plain editable field. Editing the description never changes it, a manual edit is
  canonicalized by the trigger, and an explicit `null` stays `null` (untagged on purpose).
- Canonical form: trim, uppercase, `_` becomes `-`, `EBOOKSIM` becomes `EBOOK` (so `ZERO_GRAU` and
  `ZERO-GRAU` are the same platform). `canonicalTransactionPlatformTag` in TypeScript mirrors the SQL function.

## Terminal and origin metadata

`Maquineta - Terminal: POS-RENOVADA [ORIGEM:MAQUINETA]` identifies a physical terminal/channel, not the platform `POS`. With stored `platformTag = RENOVADA`, reports associate the transaction with RENOVADA only. Terminal parsing, maquineta synchronization/listing and physical-origin filters retain their channel/origin metadata; they do not determine platform association.

## Helper

`backend/src/modules/platform-core/transaction-platform.ts`

| Export                                 | Use                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `whereTransactionPlatform(tags)`       | Prisma `where` fragment (`platformTag = x` / `in`)                       |
| `whereTransactionHasPlatform`          | any tagged row (replaces `description contains '[TENANT:'`)              |
| `sqlTransactionPlatform(alias, tags)`  | `Prisma.sql` fragment for raw queries                                    |
| `transactionPlatformTag(tx)`           | in-memory row; returns the stored tag only, never parses the description |
| `transactionPlatformTagData(tag)`      | `{ platformTag }` for `create` data (`GLOBAL` and empty stay untagged)   |
| `canonicalTransactionPlatformTag(tag)` | normalization                                                            |

Any Prisma `select` feeding an in-memory reader must include `platformTag`.

## Readers switched to the column

owned-report-source (raw SQL, report cards/charts/details),
platform-overview-reports (dashboard, withdrawals, charts; Atlas, Bosque, Areaflix, Ebook, Revalida, Betai,
Controle), platform-dashboard-reports, platform-customer-reports, platform-administration.service,
platform-attributed-balance (owner wallet), platform-finance.service,
legacy Renovada/PagaTG/Ebook/Bosque finance listings, platform-payment-lookup, platform-webhook-settlement,
platform-sync(.persistence), platform-ledger replay, integration-finance.service, platform-sales-events,
reconcile-pending-transactions, process-dom-webhook / process-webhook fee-tag and routing decisions,
list-dom-transactions-direct, admin.controller consolidado (`consolidadoTagParaTransacao`, scope),
bosque-available.helper and sync-dom-transactions. Removed legacy sync-full flows remain removed.

## Left on purpose

- Description composition (`[TENANT:x]` in checkout, boleto, payment links, subscriptions, pix-plan,
  maquineta, sync-full-*, ledger): kept for compatibility, now paired with an explicit `platformTag`.
- `platformTaxaTagFromText` on DOM `product_first` / checkout item text (external text before a Transaction
  exists), `acceptsPlatformSyncDescription` on provider rows being imported, `platform-payment.adapter` and
  `buildInternalDescription` (strip/add markers in outgoing gateway text).
- Physical-channel/origin classification (`isMaquinetaDescription`, terminal names and `[ORIGEM:MAQUINETA]`), plus `[CPF_DONO]`/`subOrder=` metadata parsing, remains separate from platform attribution.
- The legacy administrative RENOVADA wallet-repair command retains its original keyword-based financial correction behavior. It is not a reporting reader and was neither migrated nor executed here; changing it requires a separate financial-policy review. This change does not recalculate historical wallets or ledger entries.
- `jwt-auth.guard` marker check on request bodies (input validation, not attribution).

## Deployment

Code that reads `platformTag` fails at runtime on a database without the column. Apply migration
`20261029120000_transaction_platform_tag` BEFORE deploying this code (requires explicit authorization).
The column has `@@index([platformTag])`; report filters combine it with `userId`/`status`/`createdAt`, which
the existing index plus the per-user indexes serve. Add a composite index only if EXPLAIN shows a need.

## Known behavior changes for untagged history

Rows that were found only by free-text keywords (for example `atlas` or `areaflix` in the description, with
no `[TENANT:]` marker) are no longer included in those platform reports, because they have no tag. Count
them before deploying and backfill the tag deliberately if they should remain visible, for example:

```sql
UPDATE "Transaction" SET "platformTag" = 'ATLAS'
WHERE "platformTag" IS NULL AND description ILIKE '%atlas%';
```

## Tests

`backend/src/modules/platform-core/tests/transaction-platform-tag.integration.test.ts` (migration/trigger) and
`transaction-platform-readers.integration.test.ts` (readers) run against a local disposable Postgres via
`COPRODUCTION_TEST_DATABASE_URL`.
