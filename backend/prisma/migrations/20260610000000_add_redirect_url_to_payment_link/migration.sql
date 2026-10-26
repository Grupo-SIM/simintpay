-- AlterTable: URL de redirecionamento aberta em nova aba após pagamento aprovado
ALTER TABLE "PaymentLink" ADD COLUMN "redirectUrl" TEXT;
