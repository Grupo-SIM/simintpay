-- Pausa de assinatura de oferta: status PAUSED e o tempo restante guardado no contrato.
ALTER TYPE "BillingContractStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

ALTER TABLE "BillingContract"
  ADD COLUMN "pausedAt" TIMESTAMP(3),
  ADD COLUMN "pausedRemainingDays" INTEGER;
