-- AlterTable
ALTER TABLE "WithdrawRequest"
ADD COLUMN "integrationRequestId" TEXT,
ADD COLUMN "sourceBalanceSnapshot" DECIMAL(12,2),
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewSource" TEXT,
ADD COLUMN "reviewedByReference" TEXT;

-- AlterTable
ALTER TABLE "SubscriptionLinkOrder"
ADD COLUMN "currentPeriodEndsAt" TIMESTAMP(3),
ADD COLUMN "issueStartedAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReturnBetAccount" (
    "id" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReturnBetAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawRequest_integrationRequestId_key" ON "WithdrawRequest"("integrationRequestId");
CREATE UNIQUE INDEX "ReturnBetAccount_externalUserId_key" ON "ReturnBetAccount"("externalUserId");
CREATE UNIQUE INDEX "ReturnBetAccount_userId_key" ON "ReturnBetAccount"("userId");
CREATE INDEX "ReturnBetAccount_document_idx" ON "ReturnBetAccount"("document");
CREATE INDEX "ReturnBetAccount_email_idx" ON "ReturnBetAccount"("email");

-- AddForeignKey
ALTER TABLE "ReturnBetAccount" ADD CONSTRAINT "ReturnBetAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
