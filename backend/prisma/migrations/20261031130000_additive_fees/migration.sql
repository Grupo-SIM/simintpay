-- Additive fee totals per platform: SIM Delivery pushes the sum, a SimIntPay admin may override it.
CREATE TABLE "PlatformAdditiveTotals" (
    "platformId" TEXT NOT NULL,
    "deliveryOrderPct" INTEGER NOT NULL DEFAULT 0,
    "deliveryOrderFixed" INTEGER NOT NULL DEFAULT 0,
    "deliveryProductPct" INTEGER NOT NULL DEFAULT 0,
    "deliveryProductFixed" INTEGER NOT NULL DEFAULT 0,
    "overrideOrderPct" INTEGER,
    "overrideOrderFixed" INTEGER,
    "overrideProductPct" INTEGER,
    "overrideProductFixed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdditiveTotals_pkey" PRIMARY KEY ("platformId")
);

ALTER TABLE "PlatformAdditiveTotals" ADD CONSTRAINT "PlatformAdditiveTotals_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;
