-- Plan 0023: community and CONTROLE-*/BETAI provisioning were discontinued.
-- Drops the community tables, the SaaS subscriber access table and their enums.

-- DropForeignKey
ALTER TABLE "CommunityAccess" DROP CONSTRAINT "CommunityAccess_communityId_fkey";
ALTER TABLE "CommunityAccess" DROP CONSTRAINT "CommunityAccess_userId_fkey";
ALTER TABLE "CommunityLinkBinding" DROP CONSTRAINT "CommunityLinkBinding_communityId_fkey";
ALTER TABLE "CommunityLinkBinding" DROP CONSTRAINT "CommunityLinkBinding_paymentLinkId_fkey";
ALTER TABLE "CommunityLinkBinding" DROP CONSTRAINT "CommunityLinkBinding_subscriptionLinkId_fkey";
ALTER TABLE "CommunitySubscriptionEvent" DROP CONSTRAINT "CommunitySubscriptionEvent_communityId_fkey";
ALTER TABLE "CommunitySubscriptionEvent" DROP CONSTRAINT "CommunitySubscriptionEvent_subscriptionLinkOrderId_fkey";
ALTER TABLE "CommunitySubscriptionEvent" DROP CONSTRAINT "CommunitySubscriptionEvent_userId_fkey";

-- DropTable
DROP TABLE "CommunityAccess";
DROP TABLE "CommunityLinkBinding";
DROP TABLE "CommunitySubscriptionEvent";
DROP TABLE "Community";
DROP TABLE "PlatformSubscriberAccess";

-- DropEnum
DROP TYPE "CommunityEventType";
DROP TYPE "CommunityLinkType";
DROP TYPE "CommunitySource";
DROP TYPE "CommunityStatus";
