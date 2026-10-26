-- CreateTable
CREATE TABLE "PlatformSubscriberAccess" (
    "id" TEXT NOT NULL,
    "platformTag" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "customerCpf" TEXT,
    "customerPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "frozenDays" INTEGER NOT NULL DEFAULT 0,
    "totalDaysCredited" INTEGER NOT NULL DEFAULT 0,
    "lastTransactionId" TEXT,
    "lastPaymentMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSubscriberAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformSubscriberAccess_platformTag_idx" ON "PlatformSubscriberAccess"("platformTag");

-- CreateIndex
CREATE INDEX "PlatformSubscriberAccess_customerEmail_idx" ON "PlatformSubscriberAccess"("customerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSubscriberAccess_platformTag_customerEmail_key" ON "PlatformSubscriberAccess"("platformTag", "customerEmail");
