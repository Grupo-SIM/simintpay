CREATE TABLE "AcquirerWithdrawalFee" (
    "id" TEXT NOT NULL,
    "acquirerCode" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquirerWithdrawalFee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acquirer_withdrawal_fee_created_idx" ON "AcquirerWithdrawalFee"("acquirerCode", "createdAt");

ALTER TABLE "AcquirerWithdrawalFee" ADD CONSTRAINT "AcquirerWithdrawalFee_acquirerCode_fkey" FOREIGN KEY ("acquirerCode") REFERENCES "AcquirerCatalogue"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DOM keeps its historical R$ 3,50 per withdrawal until an admin changes it.
INSERT INTO "AcquirerWithdrawalFee" ("id", "acquirerCode", "feeCents", "source")
SELECT gen_random_uuid()::text, "code", 350, 'MIGRATION' FROM "AcquirerCatalogue" WHERE "code" = 'DOM';
