-- AlterTable
ALTER TABLE "PaymentLink" ADD COLUMN     "aceitaCartao" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "aceitaPix" BOOLEAN NOT NULL DEFAULT true;
