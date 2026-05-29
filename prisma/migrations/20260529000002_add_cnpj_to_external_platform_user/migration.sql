-- Make cpf nullable and add cnpj to ExternalPlatformUser
ALTER TABLE "ExternalPlatformUser" ALTER COLUMN "cpf" DROP NOT NULL;
ALTER TABLE "ExternalPlatformUser" ADD COLUMN "cnpj" TEXT;

-- Unique index for cnpj + platform (Postgres allows multiple NULLs in unique index)
CREATE UNIQUE INDEX "ExternalPlatformUser_cnpj_platform_key" ON "ExternalPlatformUser"("cnpj", "platform");
CREATE INDEX "ExternalPlatformUser_cnpj_idx" ON "ExternalPlatformUser"("cnpj");
