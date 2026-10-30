-- CreateEnum
CREATE TYPE "DeliveryFeeMode" AS ENUM ('SIMINTPAY_ONLY', 'ADDITIVE_ONLY', 'BOTH');

-- AlterTable: existing platforms keep today's additive-only behavior.
ALTER TABLE "Platform" ADD COLUMN     "deliveryFeeMode" "DeliveryFeeMode" NOT NULL DEFAULT 'ADDITIVE_ONLY';
