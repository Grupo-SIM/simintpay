ALTER TYPE "DeliveryFeeMode" RENAME TO "PlatformFeeMode";
ALTER TABLE "Platform" RENAME COLUMN "deliveryFeeMode" TO "feeMode";
ALTER TABLE "Platform" RENAME COLUMN "deliveryDisabledLanes" TO "disabledPaymentLanes";
