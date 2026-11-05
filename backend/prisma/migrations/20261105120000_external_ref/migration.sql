CREATE TABLE "ExternalRef" (
    "id" TEXT NOT NULL,
    "acquirerCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalRef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalRef_acquirerCode_kind_externalId_key" ON "ExternalRef"("acquirerCode", "kind", "externalId");
CREATE UNIQUE INDEX "ExternalRef_entityType_entityId_acquirerCode_kind_key" ON "ExternalRef"("entityType", "entityId", "acquirerCode", "kind");
CREATE INDEX "ExternalRef_entityType_entityId_idx" ON "ExternalRef"("entityType", "entityId");

ALTER TABLE "ExternalRef" ADD CONSTRAINT "ExternalRef_acquirerCode_fkey" FOREIGN KEY ("acquirerCode") REFERENCES "AcquirerCatalogue"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
