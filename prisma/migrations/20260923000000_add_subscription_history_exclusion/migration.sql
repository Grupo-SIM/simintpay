CREATE TABLE "SubscriptionHistoryExclusion" (
    "id" TEXT NOT NULL,
    "domSubscriptionId" TEXT NOT NULL,
    "removedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionHistoryExclusion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionHistoryExclusion_domSubscriptionId_key"
ON "SubscriptionHistoryExclusion"("domSubscriptionId");

CREATE INDEX "SubscriptionHistoryExclusion_removedByUserId_idx"
ON "SubscriptionHistoryExclusion"("removedByUserId");
