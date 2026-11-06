-- DropIndex
DROP INDEX "Offer_kind_idx";

-- AlterTable
ALTER TABLE "Offer" DROP COLUMN "kind";

-- DropEnum
DROP TYPE "OfferKind";

