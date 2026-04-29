-- AlterTable
ALTER TABLE "WithdrawRequest" ADD COLUMN     "platform" VARCHAR(50);

-- CreateIndex
CREATE INDEX "WithdrawRequest_platform_idx" ON "WithdrawRequest"("platform");
