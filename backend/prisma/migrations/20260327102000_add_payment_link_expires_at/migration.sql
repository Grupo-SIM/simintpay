-- Add expiration date support for payment links
ALTER TABLE "PaymentLink"
ADD COLUMN "expiresAt" TIMESTAMP(3);
