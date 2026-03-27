-- CreateTable
CREATE TABLE "PixCreditPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PlanType" NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "redirectUrl" TEXT,
    "webhookUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixCreditPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixPlanLinkCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pixCreditPlanId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixPlanLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixPlanOrder" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerDocument" TEXT NOT NULL,
    "planType" "PlanType" NOT NULL,
    "daysCredited" INTEGER NOT NULL,
    "pixCreditPlanId" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "creditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixPlanOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPlanAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pixPlanId" TEXT,
    "pixPlanCode" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerDocument" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "totalDaysCredited" INTEGER NOT NULL DEFAULT 0,
    "lastTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPlanAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PixCreditPlan_userId_idx" ON "PixCreditPlan"("userId");

-- CreateIndex
CREATE INDEX "PixCreditPlan_status_idx" ON "PixCreditPlan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PixPlanLinkCode_code_key" ON "PixPlanLinkCode"("code");

-- CreateIndex
CREATE INDEX "PixPlanLinkCode_pixCreditPlanId_idx" ON "PixPlanLinkCode"("pixCreditPlanId");

-- CreateIndex
CREATE INDEX "PixPlanLinkCode_isActive_idx" ON "PixPlanLinkCode"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PixPlanOrder_transactionId_key" ON "PixPlanOrder"("transactionId");

-- CreateIndex
CREATE INDEX "PixPlanOrder_userId_idx" ON "PixPlanOrder"("userId");

-- CreateIndex
CREATE INDEX "PixPlanOrder_customerDocument_idx" ON "PixPlanOrder"("customerDocument");

-- CreateIndex
CREATE INDEX "PixPlanOrder_customerId_idx" ON "PixPlanOrder"("customerId");

-- CreateIndex
CREATE INDEX "PixPlanOrder_pixCreditPlanId_idx" ON "PixPlanOrder"("pixCreditPlanId");

-- CreateIndex
CREATE INDEX "CustomerPlanAccess_userId_idx" ON "CustomerPlanAccess"("userId");

-- CreateIndex
CREATE INDEX "CustomerPlanAccess_customerEmail_idx" ON "CustomerPlanAccess"("customerEmail");

-- CreateIndex
CREATE INDEX "CustomerPlanAccess_pixPlanId_idx" ON "CustomerPlanAccess"("pixPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPlanAccess_userId_customerDocument_pixPlanId_key" ON "CustomerPlanAccess"("userId", "customerDocument", "pixPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPlanAccess_userId_customerId_pixPlanId_key" ON "CustomerPlanAccess"("userId", "customerId", "pixPlanId");

-- AddForeignKey
ALTER TABLE "PixCreditPlan" ADD CONSTRAINT "PixCreditPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixPlanLinkCode" ADD CONSTRAINT "PixPlanLinkCode_pixCreditPlanId_fkey" FOREIGN KEY ("pixCreditPlanId") REFERENCES "PixCreditPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixPlanOrder" ADD CONSTRAINT "PixPlanOrder_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixPlanOrder" ADD CONSTRAINT "PixPlanOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixPlanOrder" ADD CONSTRAINT "PixPlanOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixPlanOrder" ADD CONSTRAINT "PixPlanOrder_pixCreditPlanId_fkey" FOREIGN KEY ("pixCreditPlanId") REFERENCES "PixCreditPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPlanAccess" ADD CONSTRAINT "CustomerPlanAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPlanAccess" ADD CONSTRAINT "CustomerPlanAccess_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPlanAccess" ADD CONSTRAINT "CustomerPlanAccess_pixPlanId_fkey" FOREIGN KEY ("pixPlanId") REFERENCES "PixCreditPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
