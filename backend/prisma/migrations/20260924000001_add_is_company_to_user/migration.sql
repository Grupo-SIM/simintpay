SET lock_timeout = '60s';

ALTER TABLE "User"
ADD COLUMN "isCompany" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "User_isCompany_idx" ON "User"("isCompany");

-- Backfill: contas com CNPJ ja cadastrado, ou vinculadas a um TenantModule
-- (operadoras de plataforma tipo Renovada/Revalida/Bosque), sao empresas.
-- Contas de plataforma identificadas so por KNOWN_PLATFORM_IDS (env var, sem
-- tenantModuleId no banco) NAO entram aqui — precisam ser marcadas manualmente
-- via admin (endpoint PATCH /admin/usuarios/:userId/marcar-empresa).
UPDATE "User" SET "isCompany" = true
WHERE "cnpj" IS NOT NULL OR "tenantModuleId" IS NOT NULL;
