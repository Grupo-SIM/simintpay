-- Local migration artifact only. Apply explicitly after backup and link diagnostics.
-- Ownership and all financial tables remain untouched.
BEGIN;
LOCK TABLE "User", "TenantModule", "Platform" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "User" u
    LEFT JOIN "Platform" p ON p."tenantModuleId" = u."tenantModuleId"
    WHERE u."tenantModuleId" IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'PLATFORM_LINK_MISSING: associate each referenced TenantModule with a registered Platform before applying';
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN "platformId" TEXT;
UPDATE "User" u SET "platformId" = p.id
FROM "Platform" p WHERE p."tenantModuleId" = u."tenantModuleId";
CREATE INDEX "User_platformId_idx" ON "User"("platformId");
ALTER TABLE "User" ADD CONSTRAINT "User_platformId_fkey"
  FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" DROP CONSTRAINT "User_tenantModuleId_fkey";
DROP INDEX "User_tenantModuleId_idx";
ALTER TABLE "User" DROP COLUMN "tenantModuleId";
ALTER TABLE "Platform" DROP CONSTRAINT "Platform_tenantModuleId_fkey";
DROP INDEX "Platform_tenantModuleId_key";
ALTER TABLE "Platform" DROP COLUMN "tenantModuleId";
DROP TABLE "TenantModule";
COMMIT;
