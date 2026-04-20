-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "allowedLinkCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
