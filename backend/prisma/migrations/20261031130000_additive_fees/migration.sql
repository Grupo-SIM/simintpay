-- Global catalog of additive fees (surcharges added to the buyer price) and per-platform association/overrides.
CREATE TABLE "AdditiveFee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "applicationScope" TEXT NOT NULL,
    "displayMode" TEXT NOT NULL,
    "percentageBps" INTEGER NOT NULL DEFAULT 0,
    "fixedCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdditiveFee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformAdditiveFee" (
    "platformId" TEXT NOT NULL,
    "feeId" TEXT NOT NULL,
    "percentageOverride" INTEGER,
    "fixedOverride" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdditiveFee_pkey" PRIMARY KEY ("platformId","feeId")
);

CREATE UNIQUE INDEX "AdditiveFee_nameKey_key" ON "AdditiveFee"("nameKey");
CREATE INDEX "AdditiveFee_active_deletedAt_idx" ON "AdditiveFee"("active", "deletedAt");
CREATE INDEX "PlatformAdditiveFee_feeId_idx" ON "PlatformAdditiveFee"("feeId");

ALTER TABLE "PlatformAdditiveFee" ADD CONSTRAINT "PlatformAdditiveFee_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformAdditiveFee" ADD CONSTRAINT "PlatformAdditiveFee_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "AdditiveFee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
