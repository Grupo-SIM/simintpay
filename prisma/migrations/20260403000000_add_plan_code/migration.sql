-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
