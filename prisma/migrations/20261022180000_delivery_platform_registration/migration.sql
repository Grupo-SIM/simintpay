CREATE TABLE "DeliveryPlatformRegistration" (
    "id" TEXT NOT NULL,
    "integrationKey" TEXT NOT NULL,
    "externalMerchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platformId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryPlatformRegistration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliveryPlatformRegistration_integrationKey_key" ON "DeliveryPlatformRegistration"("integrationKey");
CREATE UNIQUE INDEX "DeliveryPlatformRegistration_externalMerchantId_key" ON "DeliveryPlatformRegistration"("externalMerchantId");
CREATE INDEX "DeliveryPlatformRegistration_platformId_idx" ON "DeliveryPlatformRegistration"("platformId");
ALTER TABLE "DeliveryPlatformRegistration" ADD CONSTRAINT "DeliveryPlatformRegistration_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
