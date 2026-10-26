CREATE TABLE "IntegrationMerchant" (
    "id" TEXT NOT NULL,
    "integrationKey" TEXT NOT NULL,
    "externalMerchantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationMerchant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationWebhookDelivery" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "withdrawalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationMerchant_userId_key" ON "IntegrationMerchant"("userId");
CREATE UNIQUE INDEX "IntegrationMerchant_integrationKey_externalMerchantId_key" ON "IntegrationMerchant"("integrationKey", "externalMerchantId");
CREATE UNIQUE INDEX "IntegrationMerchant_integrationKey_cnpj_key" ON "IntegrationMerchant"("integrationKey", "cnpj");
CREATE INDEX "IntegrationMerchant_integrationKey_idx" ON "IntegrationMerchant"("integrationKey");
CREATE UNIQUE INDEX "IntegrationWebhookDelivery_withdrawalId_status_key" ON "IntegrationWebhookDelivery"("withdrawalId", "status");
CREATE INDEX "IntegrationWebhookDelivery_deliveredAt_nextAttemptAt_idx" ON "IntegrationWebhookDelivery"("deliveredAt", "nextAttemptAt");

ALTER TABLE "IntegrationMerchant" ADD CONSTRAINT "IntegrationMerchant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationWebhookDelivery" ADD CONSTRAINT "IntegrationWebhookDelivery_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "IntegrationMerchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationWebhookDelivery" ADD CONSTRAINT "IntegrationWebhookDelivery_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "WithdrawRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
