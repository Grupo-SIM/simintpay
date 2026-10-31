BEGIN;

ALTER TABLE "PaymentLink" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "Boleto" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "SubscriptionLink" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "PixCreditPlan" ADD COLUMN "createdByUserId" TEXT;

-- Preserve each legacy override, including zero; existing durable overrides win.
INSERT INTO "PlatformTaxaOverride" ("id", "tag", "key", "value", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'USER:' || upper(u."id"), o."key", o."value", o."createdAt", o."updatedAt"
FROM "PlatformTaxaOverride" o JOIN "User" u ON o."tag" = 'CLIENT:' || upper(trim(u."email"))
ON CONFLICT ("tag", "key") DO NOTHING;

COMMIT;
