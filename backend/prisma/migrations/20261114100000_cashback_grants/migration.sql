CREATE TABLE "CashbackGrant" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashbackGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashbackGrant_transactionId_key" ON "CashbackGrant"("transactionId");
CREATE INDEX "CashbackGrant_status_nextAttemptAt_idx" ON "CashbackGrant"("status", "nextAttemptAt");
