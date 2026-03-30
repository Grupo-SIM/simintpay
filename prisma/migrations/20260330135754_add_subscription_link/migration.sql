-- CreateTable
CREATE TABLE "SubscriptionLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ownerEmail" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "frequencyType" "PlanType" NOT NULL,
    "isStandalone" BOOLEAN NOT NULL DEFAULT true,
    "platformFee" DOUBLE PRECISION NOT NULL DEFAULT 9.00,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "redirectUrl" TEXT,
    "webhookUrl" TEXT,
    "maxUses" INTEGER,
    "currentUses" INTEGER NOT NULL DEFAULT 0,
    "domPlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionLinkOrder" (
    "id" TEXT NOT NULL,
    "subscriptionLinkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerDocument" TEXT NOT NULL,
    "customerPhone" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CREDIT_CARD',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "domSubscriptionId" TEXT,
    "domPixPaymentId" TEXT,
    "pixContent" TEXT,
    "pixExpire" TIMESTAMP(3),
    "amountCharged" DECIMAL(12,2) NOT NULL,
    "platformFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionLinkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionLink_code_key" ON "SubscriptionLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionLink_domPlanId_key" ON "SubscriptionLink"("domPlanId");

-- CreateIndex
CREATE INDEX "SubscriptionLink_userId_idx" ON "SubscriptionLink"("userId");

-- CreateIndex
CREATE INDEX "SubscriptionLink_code_idx" ON "SubscriptionLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionLinkOrder_domSubscriptionId_key" ON "SubscriptionLinkOrder"("domSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionLinkOrder_domPixPaymentId_key" ON "SubscriptionLinkOrder"("domPixPaymentId");

-- CreateIndex
CREATE INDEX "SubscriptionLinkOrder_subscriptionLinkId_idx" ON "SubscriptionLinkOrder"("subscriptionLinkId");

-- CreateIndex
CREATE INDEX "SubscriptionLinkOrder_userId_idx" ON "SubscriptionLinkOrder"("userId");

-- CreateIndex
CREATE INDEX "SubscriptionLinkOrder_customerEmail_idx" ON "SubscriptionLinkOrder"("customerEmail");

-- AddForeignKey
ALTER TABLE "SubscriptionLink" ADD CONSTRAINT "SubscriptionLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLinkOrder" ADD CONSTRAINT "SubscriptionLinkOrder_subscriptionLinkId_fkey" FOREIGN KEY ("subscriptionLinkId") REFERENCES "SubscriptionLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLinkOrder" ADD CONSTRAINT "SubscriptionLinkOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
