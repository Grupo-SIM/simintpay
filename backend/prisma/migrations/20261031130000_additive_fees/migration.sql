-- Resolved additive fee values pushed by SIM Delivery (it owns the catalog); SimIntPay stores values only.
CREATE TABLE "PlatformAdditiveValue" (
    "platformId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applicationScope" TEXT NOT NULL,
    "percentageValue" INTEGER NOT NULL DEFAULT 0,
    "fixedValue" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdditiveValue_pkey" PRIMARY KEY ("platformId","externalId")
);

ALTER TABLE "PlatformAdditiveValue" ADD CONSTRAINT "PlatformAdditiveValue_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;
