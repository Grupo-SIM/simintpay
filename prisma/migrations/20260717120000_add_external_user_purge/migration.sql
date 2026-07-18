-- AlterTable: exclusão permanente de conta externa (estado final, saldo absorvido pelo master).
-- Não apagamos a linha — apagar mudaria o histórico/relatórios retroativamente.
ALTER TABLE "ExternalPlatformUser"
  ADD COLUMN "isPurged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "purgedAt" TIMESTAMP(3),
  ADD COLUMN "purgedAmount" DECIMAL(12,2);
