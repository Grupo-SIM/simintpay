-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tenantModuleId" TEXT;

-- CreateTable
CREATE TABLE "TenantModule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantModule_slug_key" ON "TenantModule"("slug");

-- CreateIndex
CREATE INDEX "TenantModule_slug_idx" ON "TenantModule"("slug");

-- CreateIndex
CREATE INDEX "User_tenantModuleId_idx" ON "User"("tenantModuleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantModuleId_fkey" FOREIGN KEY ("tenantModuleId") REFERENCES "TenantModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
