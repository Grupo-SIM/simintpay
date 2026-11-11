-- A voucher is consumed once per paid transaction (idempotent usage recording).
-- Keep the oldest row of any duplicated pair before the unique index exists.
DELETE FROM "VoucherUsage" a
USING "VoucherUsage" b
WHERE a."transactionId" IS NOT NULL
  AND a."voucherId" = b."voucherId"
  AND a."transactionId" = b."transactionId"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

CREATE UNIQUE INDEX "VoucherUsage_voucherId_transactionId_key"
  ON "VoucherUsage"("voucherId", "transactionId");
