ALTER TABLE "AcquirerWithdrawal" ADD COLUMN "amountCents" INTEGER,
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "AcquirerWithdrawal_acquirerCode_externalId_key" ON "AcquirerWithdrawal"("acquirerCode", "externalId");
