-- CreateTable
CREATE TABLE "Boleto" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "vencimentoDias" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "webhookUrl" TEXT,
    "redirectUrl" TEXT,
    "maxUses" INTEGER,
    "currentUses" INTEGER NOT NULL DEFAULT 0,
    "domPaymentLinkId" TEXT,
    "domLink" TEXT,
    "plataformas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Boleto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Boleto_code_key" ON "Boleto"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Boleto_domPaymentLinkId_key" ON "Boleto"("domPaymentLinkId");

-- CreateIndex
CREATE INDEX "Boleto_userId_idx" ON "Boleto"("userId");

-- CreateIndex
CREATE INDEX "Boleto_code_idx" ON "Boleto"("code");

-- AddForeignKey
ALTER TABLE "Boleto" ADD CONSTRAINT "Boleto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
