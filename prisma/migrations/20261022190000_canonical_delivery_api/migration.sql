CREATE TABLE "PaymentIntegrationProfile" (
 "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "acquirer" "Acquirer" NOT NULL DEFAULT 'DOM',
 "encryptedCredential" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PlatformApiCredential" (
 "id" TEXT PRIMARY KEY, "source" TEXT NOT NULL DEFAULT 'delivery', "externalCompanyId" TEXT NOT NULL UNIQUE,
 "platformId" TEXT NOT NULL REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "merchantId" TEXT NOT NULL, "profileId" TEXT NOT NULL REFERENCES "PaymentIntegrationProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "tokenHash" TEXT NOT NULL UNIQUE, "encryptedToken" TEXT NOT NULL, "encryptedWebhookSecret" TEXT NOT NULL,
 "operations" TEXT[] NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PlatformApiCredential_platformId_merchantId_idx" ON "PlatformApiCredential"("platformId", "merchantId");
CREATE TABLE "CanonicalCardCustomer" (
 "id" TEXT PRIMARY KEY, "credentialId" TEXT NOT NULL REFERENCES "PlatformApiCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "externalCustomerId" TEXT NOT NULL, "providerCustomerId" TEXT NOT NULL,
 UNIQUE ("credentialId", "externalCustomerId")
);
CREATE TABLE "CanonicalMerchantEvent" (
 "id" TEXT PRIMARY KEY, "credentialId" TEXT NOT NULL REFERENCES "PlatformApiCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "eventId" TEXT NOT NULL UNIQUE, "payload" JSONB NOT NULL, "deliveredAt" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CanonicalMerchantEvent_deliveredAt_nextAttemptAt_idx" ON "CanonicalMerchantEvent"("deliveredAt", "nextAttemptAt");
