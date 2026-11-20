-- 0 is now a real 0% target; "off" for a platform override is stored as -1.
UPDATE "Platform" SET "targetFeePpm" = -1 WHERE "targetFeePpm" = 0;
