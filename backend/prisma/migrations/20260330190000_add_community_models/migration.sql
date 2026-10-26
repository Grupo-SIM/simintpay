-- CreateEnum
CREATE TYPE "CommunitySource" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "CommunityLinkType" AS ENUM ('SUBSCRIPTION_LINK', 'PAYMENT_LINK');

-- CreateEnum
CREATE TYPE "CommunityStatus" AS ENUM ('ATIVA', 'INADIMPLENTE', 'PLANO_ENCERRADO', 'INATIVA');

-- CreateEnum
CREATE TYPE "CommunityEventType" AS ENUM ('ACTIVATED', 'RENEWED', 'PIX_PENDING', 'EXPIRED', 'MANUAL_ADJUST');

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" "CommunitySource" NOT NULL DEFAULT 'AUTOMATIC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityLinkBinding" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "bindingType" "CommunityLinkType" NOT NULL,
    "subscriptionLinkId" TEXT,
    "paymentLinkId" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityLinkBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityAccess" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CommunityStatus" NOT NULL DEFAULT 'ATIVA',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "statusReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "totalDaysCredited" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunitySubscriptionEvent" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "CommunityEventType" NOT NULL,
    "paymentMethod" "PaymentMethod",
    "amountCharged" DECIMAL(12,2),
    "subscriptionLinkOrderId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunitySubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Community_slug_key" ON "Community"("slug");

-- CreateIndex
CREATE INDEX "Community_slug_idx" ON "Community"("slug");

-- CreateIndex
CREATE INDEX "CommunityLinkBinding_communityId_idx" ON "CommunityLinkBinding"("communityId");

-- CreateIndex
CREATE INDEX "CommunityLinkBinding_subscriptionLinkId_idx" ON "CommunityLinkBinding"("subscriptionLinkId");

-- CreateIndex
CREATE INDEX "CommunityLinkBinding_paymentLinkId_idx" ON "CommunityLinkBinding"("paymentLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityAccess_communityId_userId_key" ON "CommunityAccess"("communityId", "userId");

-- CreateIndex
CREATE INDEX "CommunityAccess_communityId_idx" ON "CommunityAccess"("communityId");

-- CreateIndex
CREATE INDEX "CommunityAccess_userId_idx" ON "CommunityAccess"("userId");

-- CreateIndex
CREATE INDEX "CommunityAccess_isActive_idx" ON "CommunityAccess"("isActive");

-- CreateIndex
CREATE INDEX "CommunitySubscriptionEvent_communityId_idx" ON "CommunitySubscriptionEvent"("communityId");

-- CreateIndex
CREATE INDEX "CommunitySubscriptionEvent_userId_idx" ON "CommunitySubscriptionEvent"("userId");

-- CreateIndex
CREATE INDEX "CommunitySubscriptionEvent_eventType_idx" ON "CommunitySubscriptionEvent"("eventType");

-- AddForeignKey
ALTER TABLE "CommunityLinkBinding" ADD CONSTRAINT "CommunityLinkBinding_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityLinkBinding" ADD CONSTRAINT "CommunityLinkBinding_subscriptionLinkId_fkey" FOREIGN KEY ("subscriptionLinkId") REFERENCES "SubscriptionLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityLinkBinding" ADD CONSTRAINT "CommunityLinkBinding_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityAccess" ADD CONSTRAINT "CommunityAccess_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityAccess" ADD CONSTRAINT "CommunityAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySubscriptionEvent" ADD CONSTRAINT "CommunitySubscriptionEvent_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySubscriptionEvent" ADD CONSTRAINT "CommunitySubscriptionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySubscriptionEvent" ADD CONSTRAINT "CommunitySubscriptionEvent_subscriptionLinkOrderId_fkey" FOREIGN KEY ("subscriptionLinkOrderId") REFERENCES "SubscriptionLinkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
