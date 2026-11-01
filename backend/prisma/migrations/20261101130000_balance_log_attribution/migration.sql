-- Additive only: NULL means unclassified. Never infer historical attribution.
ALTER TABLE "BalanceLog"
  ADD COLUMN "platformTag" TEXT,
  ADD COLUMN "nature" TEXT;
CREATE INDEX "BalanceLog_userId_platformTag_nature_idx"
  ON "BalanceLog"("userId", "platformTag", "nature");
