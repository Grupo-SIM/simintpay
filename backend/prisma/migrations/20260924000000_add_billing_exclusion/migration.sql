SET lock_timeout = '60s';

ALTER TABLE "User"
ADD COLUMN "billingExcluded" BOOLEAN NOT NULL DEFAULT false;
