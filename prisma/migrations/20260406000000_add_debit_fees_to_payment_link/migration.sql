-- AddColumn debitFeePercent, debitFeeFixed e aceitaDebito na tabela PaymentLink
ALTER TABLE "PaymentLink" ADD COLUMN IF NOT EXISTS "debitFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 2.00;
ALTER TABLE "PaymentLink" ADD COLUMN IF NOT EXISTS "debitFeeFixed" DOUBLE PRECISION NOT NULL DEFAULT 2.00;
ALTER TABLE "PaymentLink" ADD COLUMN IF NOT EXISTS "aceitaDebito" BOOLEAN NOT NULL DEFAULT true;
