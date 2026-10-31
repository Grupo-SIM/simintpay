CREATE TYPE "PaymentAttemptStatus" AS ENUM ('RESERVED', 'DISPATCHING', 'UNKNOWN', 'PRE_CREATION_FAILED', 'TERMINAL_NONPAYABLE', 'ACCEPTED', 'SUCCEEDED', 'FAILED');

CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "externalReference" TEXT NOT NULL,
  "provider" "Acquirer" NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL,
  "evidence" JSONB,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "providerPaymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentAttempt_externalReference_key" ON "PaymentAttempt"("externalReference");
CREATE UNIQUE INDEX "PaymentAttempt_transactionId_sequence_key" ON "PaymentAttempt"("transactionId", "sequence");
CREATE INDEX "PaymentAttempt_transactionId_status_idx" ON "PaymentAttempt"("transactionId", "status");
CREATE UNIQUE INDEX "PaymentAttempt_provider_providerPaymentId_key" ON "PaymentAttempt"("provider", "providerPaymentId");
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PaymentCircuitState" (
  "provider" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CLOSED',
  "fence" BIGINT NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "cooldownUntil" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentCircuitState_pkey" PRIMARY KEY ("provider", "operation"),
  CONSTRAINT "PaymentCircuitState_status_check" CHECK ("status" IN ('CLOSED', 'OPEN', 'HALF_OPEN'))
);

CREATE TABLE "PaymentCircuitEvent" (
  "token" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "probe" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentCircuitEvent_pkey" PRIMARY KEY ("token"),
  CONSTRAINT "PaymentCircuitEvent_outcome_check" CHECK ("outcome" IN ('SUCCESS', 'FAILURE', 'IGNORE'))
);
CREATE INDEX "PaymentCircuitEvent_provider_operation_createdAt_idx" ON "PaymentCircuitEvent"("provider", "operation", "createdAt");
