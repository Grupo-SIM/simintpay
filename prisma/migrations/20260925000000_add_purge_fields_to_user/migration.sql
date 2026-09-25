SET lock_timeout = '60s';

ALTER TABLE "User"
ADD COLUMN "isPurged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "purgedAt" TIMESTAMP(3),
ADD COLUMN "purgedAmount" DECIMAL(12,2);
