ALTER TABLE "AcquirerCatalogue" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AcquirerCatalogue" ADD COLUMN "syncAdapter" TEXT;

CREATE TABLE "AcquirerFeeSchedule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "acquirerCode" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "installments" INTEGER NOT NULL,
  "fixedCents" INTEGER NOT NULL,
  "ratePpm" INTEGER NOT NULL,
  "interestPpm" INTEGER NOT NULL,
  "base" TEXT NOT NULL DEFAULT 'BUYER_TOTAL',
  "source" TEXT NOT NULL,
  "actorId" TEXT,
  "changeDirection" TEXT NOT NULL DEFAULT 'INITIAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcquirerFeeSchedule_acquirerCode_fkey" FOREIGN KEY ("acquirerCode") REFERENCES "AcquirerCatalogue"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "acquirer_fee_lane_created_idx" ON "AcquirerFeeSchedule"("acquirerCode", "method", "channel", "installments", "createdAt");

-- Preserve existing admin-configured costs as an initial audit revision.
-- Missing lanes are intentionally left missing and use the explicit pricing fallback.
INSERT INTO "AcquirerFeeSchedule" ("id", "acquirerCode", "method", "channel", "installments", "fixedCents", "ratePpm", "interestPpm", "base", "source", "createdAt")
SELECT gen_random_uuid()::text, parts[1], parts[2], parts[3], parts[4]::integer,
  COALESCE((lane->'contract'->>'fixedCents')::integer, 0),
  COALESCE((lane->'contract'->>'ratePpm')::integer, 0),
  COALESCE((lane->'contract'->>'interestPpm')::integer, 0),
  COALESCE(lane->'contract'->>'base', 'ORIGINAL'), 'MIGRATION', latest."createdAt"
FROM (
  SELECT DISTINCT ON ("tag") "tag", "document", "createdAt" FROM "FinancialPolicyRevision" ORDER BY "tag", "version" DESC
) latest,
LATERAL jsonb_each(latest."document"->'lanes') AS entry(key, lane),
LATERAL string_to_array(entry.key, '/') AS parts
WHERE latest."tag" = 'GLOBAL' AND cardinality(parts) = 4 AND parts[4] ~ '^[0-9]+$'
  AND parts[1] IN (SELECT "code" FROM "AcquirerCatalogue");

UPDATE "AcquirerCatalogue" SET "syncAdapter" = 'DOM' WHERE "code" = 'DOM';
