ALTER TABLE "Transaction" ADD COLUMN "settlementBasis" TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_settlementBasis_check" CHECK ("settlementBasis" IS NULL OR "settlementBasis" = 'FINAL_NET');
