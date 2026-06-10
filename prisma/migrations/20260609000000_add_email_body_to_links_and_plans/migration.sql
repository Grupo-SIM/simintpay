-- AlterTable: corpo de e-mail personalizado (apenas itens de ebook)
ALTER TABLE "Plan" ADD COLUMN "emailBody" TEXT;
ALTER TABLE "SubscriptionLink" ADD COLUMN "emailBody" TEXT;
ALTER TABLE "PaymentLink" ADD COLUMN "emailBody" TEXT;
ALTER TABLE "PixCreditPlan" ADD COLUMN "emailBody" TEXT;
