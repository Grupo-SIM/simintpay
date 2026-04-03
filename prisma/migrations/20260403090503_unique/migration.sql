-- CreateTable
CREATE TABLE "ExternalPlatformUser" (
    "id" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalPlatformWallet" (
    "id" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lockedBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPlatformWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalPlatformUser_cpf_idx" ON "ExternalPlatformUser"("cpf");

-- CreateIndex
CREATE INDEX "ExternalPlatformUser_platform_idx" ON "ExternalPlatformUser"("platform");

-- CreateIndex
CREATE INDEX "ExternalPlatformUser_userId_idx" ON "ExternalPlatformUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPlatformUser_cpf_platform_key" ON "ExternalPlatformUser"("cpf", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPlatformWallet_externalUserId_key" ON "ExternalPlatformWallet"("externalUserId");

-- AddForeignKey
ALTER TABLE "ExternalPlatformUser" ADD CONSTRAINT "ExternalPlatformUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalPlatformWallet" ADD CONSTRAINT "ExternalPlatformWallet_externalUserId_fkey" FOREIGN KEY ("externalUserId") REFERENCES "ExternalPlatformUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
