-- CreateEnum
CREATE TYPE "Acquirer" AS ENUM ('DOM', 'FRENDZ');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "acquirer" "Acquirer" NOT NULL DEFAULT 'DOM',
ADD COLUMN     "externalPaymentId" TEXT,
ADD COLUMN     "externalTransactionId" TEXT;

-- AlterTable
ALTER TABLE "WithdrawRequest" ADD COLUMN     "acquirer" "Acquirer" NOT NULL DEFAULT 'DOM',
ADD COLUMN     "externalWithdrawId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_acquirer_idx" ON "Transaction"("acquirer");

-- CreateIndex
CREATE INDEX "Transaction_acquirer_externalPaymentId_idx" ON "Transaction"("acquirer", "externalPaymentId");

-- CreateIndex
CREATE INDEX "WithdrawRequest_acquirer_idx" ON "WithdrawRequest"("acquirer");
