ALTER TABLE "Transaction" ADD COLUMN "tracking" JSONB;
CREATE TABLE "PlatformSalesEvent" (
 "sequence" BIGSERIAL PRIMARY KEY, "eventId" TEXT NOT NULL UNIQUE, "platformId" TEXT NOT NULL REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "url" TEXT NOT NULL, "payload" JSONB NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deliveredAt" TIMESTAMP(3), "emailDeliveredAt" TIMESTAMP(3),
 "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PlatformSalesEvent_platformId_sequence_idx" ON "PlatformSalesEvent"("platformId", "sequence");
CREATE INDEX "PlatformSalesEvent_deliveredAt_nextAttemptAt_idx" ON "PlatformSalesEvent"("deliveredAt", "nextAttemptAt");
