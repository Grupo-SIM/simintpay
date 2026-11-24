-- CPF/CNPJ the merchant issued the sale under, informed by the integrating platform.
ALTER TABLE "Transaction" ADD COLUMN "merchantDocument" TEXT;
