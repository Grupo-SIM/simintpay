-- AlterTable Plan: adicionar campo plataformas (array de tags)
ALTER TABLE "Plan" ADD COLUMN "plataformas" TEXT[] NOT NULL DEFAULT '{}';

-- AlterTable SubscriptionLink: adicionar campo plataformas
ALTER TABLE "SubscriptionLink" ADD COLUMN "plataformas" TEXT[] NOT NULL DEFAULT '{}';

-- AlterTable PaymentLink: adicionar campo plataformas
ALTER TABLE "PaymentLink" ADD COLUMN "plataformas" TEXT[] NOT NULL DEFAULT '{}';
