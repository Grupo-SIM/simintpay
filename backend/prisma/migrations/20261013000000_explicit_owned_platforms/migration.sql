CREATE TABLE "Platform" (
 "id" TEXT NOT NULL,
 "tag" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "ownerUserId" TEXT NOT NULL,
 "isActive" BOOLEAN NOT NULL DEFAULT true,
 "acquirer" "Acquirer" NOT NULL DEFAULT 'DOM',
 "tenantModuleId" TEXT,
 "customerInterestRates" JSONB NOT NULL DEFAULT '{}',
 "absorbCustomerInterest" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "Platform_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Platform_tag_key" ON "Platform"("tag");
CREATE INDEX "Platform_ownerUserId_idx" ON "Platform"("ownerUserId");
ALTER TABLE "Platform" ADD CONSTRAINT "Platform_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PlatformIntegration" (
 "id" TEXT NOT NULL,
 "platformId" TEXT NOT NULL,
 "key" TEXT NOT NULL,
 "encryptedValue" TEXT,
 "tokenHash" TEXT,
 "url" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PlatformIntegration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformIntegration_platformId_key_key" ON "PlatformIntegration"("platformId", "key");
ALTER TABLE "PlatformIntegration" ADD CONSTRAINT "PlatformIntegration_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Platform_tenantModuleId_key" ON "Platform"("tenantModuleId");
ALTER TABLE "Platform" ADD CONSTRAINT "Platform_tenantModuleId_fkey" FOREIGN KEY ("tenantModuleId") REFERENCES "TenantModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "PlatformIntegration_tokenHash_key" ON "PlatformIntegration"("tokenHash");
