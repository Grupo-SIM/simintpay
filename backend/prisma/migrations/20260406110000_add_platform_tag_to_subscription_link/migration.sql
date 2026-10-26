-- Add platformTag field to SubscriptionLink
ALTER TABLE "SubscriptionLink" ADD COLUMN IF NOT EXISTS "platformTag" TEXT;
