-- AlterTable
ALTER TABLE "PixCreditPlan" ADD COLUMN "tenantTag" TEXT;

-- CreateIndex
CREATE INDEX "PixCreditPlan_tenantTag_idx" ON "PixCreditPlan"("tenantTag");
