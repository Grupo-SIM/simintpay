ALTER TABLE "User" ADD COLUMN "phone" TEXT;

UPDATE "User" u
SET "phone" = l."phone"
FROM "Lead" l
WHERE l."approvedUserId" = u."id" AND u."phone" IS NULL;
