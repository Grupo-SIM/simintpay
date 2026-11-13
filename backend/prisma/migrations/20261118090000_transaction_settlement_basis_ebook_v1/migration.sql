-- O fluxo Ebook grava settlementBasis = 'EBOOK_V1', valor que o CHECK original rejeitava.
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_settlementBasis_check";
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_settlementBasis_check"
  CHECK ("settlementBasis" IS NULL OR "settlementBasis" IN ('FINAL_NET', 'EBOOK_V1'));
