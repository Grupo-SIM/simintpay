-- SimIntPay's own fees are the default; Delivery is switched to ADDITIVE_ONLY by hand.
ALTER TABLE "Platform" ALTER COLUMN "deliveryFeeMode" SET DEFAULT 'SIMINTPAY_ONLY';
UPDATE "Platform" SET "deliveryFeeMode" = 'SIMINTPAY_ONLY';
