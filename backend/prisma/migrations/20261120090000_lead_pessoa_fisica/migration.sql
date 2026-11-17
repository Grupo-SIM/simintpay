-- Leads de pessoa física (CPF) não informam dados da empresa.
ALTER TABLE "Lead"
  ALTER COLUMN "razaoSocial" DROP NOT NULL,
  ALTER COLUMN "cnpj" DROP NOT NULL,
  ALTER COLUMN "faturamento" DROP NOT NULL,
  ALTER COLUMN "tempoOperacao" DROP NOT NULL,
  ALTER COLUMN "cargo" DROP NOT NULL;
