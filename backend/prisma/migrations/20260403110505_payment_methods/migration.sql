-- Add paymentMethods column to Plan (nullable, default BOTH)
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "paymentMethods" TEXT NOT NULL DEFAULT 'BOTH';

