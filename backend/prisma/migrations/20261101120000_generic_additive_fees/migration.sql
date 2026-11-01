-- Operational provenance only: intentionally absent from the live Prisma model.
CREATE TABLE "LegacyPlatformAdditiveTotalsBackup" AS
SELECT t.*, c."externalCompanyId" AS "companyId", 1 AS "revision",
 (t."overrideOrderPct" IS NOT NULL AND t."overrideOrderFixed" IS NOT NULL
  AND t."overrideProductPct" IS NOT NULL AND t."overrideProductFixed" IS NOT NULL) AS "overridden"
FROM "PlatformAdditiveTotals" t LEFT JOIN "PlatformApiCredential" c ON c."platformId" = t."platformId" AND c."source" = 'delivery';

CREATE TABLE "PlatformAdditiveFees" (
 "platformId" TEXT PRIMARY KEY REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "orderPct" INTEGER NOT NULL DEFAULT 0, "orderFixed" INTEGER NOT NULL DEFAULT 0,
 "productPct" INTEGER NOT NULL DEFAULT 0, "productFixed" INTEGER NOT NULL DEFAULT 0,
 "revision" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
INSERT INTO "PlatformAdditiveFees"
SELECT "platformId",
 CASE WHEN "overrideOrderPct" IS NOT NULL AND "overrideOrderFixed" IS NOT NULL AND "overrideProductPct" IS NOT NULL AND "overrideProductFixed" IS NOT NULL THEN "overrideOrderPct" ELSE "deliveryOrderPct" END,
 CASE WHEN "overrideOrderPct" IS NOT NULL AND "overrideOrderFixed" IS NOT NULL AND "overrideProductPct" IS NOT NULL AND "overrideProductFixed" IS NOT NULL THEN "overrideOrderFixed" ELSE "deliveryOrderFixed" END,
 CASE WHEN "overrideOrderPct" IS NOT NULL AND "overrideOrderFixed" IS NOT NULL AND "overrideProductPct" IS NOT NULL AND "overrideProductFixed" IS NOT NULL THEN "overrideProductPct" ELSE "deliveryProductPct" END,
 CASE WHEN "overrideOrderPct" IS NOT NULL AND "overrideOrderFixed" IS NOT NULL AND "overrideProductPct" IS NOT NULL AND "overrideProductFixed" IS NOT NULL THEN "overrideProductFixed" ELSE "deliveryProductFixed" END,
 1, "createdAt", "updatedAt"
FROM "PlatformAdditiveTotals";
DROP TABLE "PlatformAdditiveTotals";
