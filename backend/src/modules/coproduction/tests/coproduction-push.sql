-- Run only on disposable localhost PostgreSQL. Everything is rolled back.
BEGIN;
CREATE SCHEMA coproduction_push_test;
SET LOCAL search_path TO coproduction_push_test;
CREATE TABLE "User" (id text PRIMARY KEY, "clientStatus" text, "isActive" boolean DEFAULT true, "isPurged" boolean DEFAULT false);
CREATE TABLE "Transaction" (id text PRIMARY KEY, "userId" text, amount numeric(12,2), status text, "createdAt" timestamptz DEFAULT now(), "financialSnapshot" jsonb);
CREATE TABLE "Plan" (id text PRIMARY KEY);
CREATE TABLE "TransactionStatusHistory" ("transactionId" text, "toStatus" text);
CREATE TABLE "CoproductionAllocation" ("transactionId" text, "userId" text, amount numeric(12,2), state text, "createdAt" timestamp DEFAULT now(), PRIMARY KEY ("transactionId", "userId"));
INSERT INTO "User" VALUES ('owner','APPROVED',true,false), ('a','APPROVED',true,false), ('b','APPROVED',true,false), ('pending','PENDING',true,false), ('inactive','APPROVED',false,false);
INSERT INTO "Transaction" VALUES ('old','owner',100,'COMPLETED','2020-01-01','{"coproduction":{}}');
INSERT INTO "CoproductionAllocation" VALUES ('old','owner',50,'AVAILABLE',now()), ('old','a',50,'AVAILABLE',now());
\ir ../../../../prisma/migrations/202610140001_sale_push/migration.sql
\ir ../../../../prisma/migrations/202610210001_coproduction_push/migration.sql
INSERT INTO "PushSubscription" (id,"userId",endpoint,p256dh,auth) VALUES ('owner-1','owner','https://owner/1','key','key'),('owner-2','owner','https://owner/2','key','key'),('a-1','a','https://a/1','key','key'),('b-1','b','https://b/1','key','key');
-- Historic/released allocations never create retrospective notifications.
UPDATE "CoproductionAllocation" SET state='LOCKED' WHERE "transactionId"='old';
UPDATE "CoproductionAllocation" SET state='AVAILABLE' WHERE "transactionId"='old';
INSERT INTO "Transaction" (id,"userId",amount,status,"financialSnapshot") VALUES ('sale','owner',100,'PENDING','{"coproduction":{}}');
UPDATE "Transaction" SET status='COMPLETED' WHERE id='sale';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "SalePushEvent" WHERE "transactionId"='sale') THEN RAISE EXCEPTION 'gross event before allocations'; END IF; END $$;
INSERT INTO "CoproductionAllocation" ("transactionId","userId",amount,state) VALUES ('sale','owner',45.01,'REVERSED'),('sale','a',27,'REVERSED'),('sale','b',18,'REVERSED');
UPDATE "CoproductionAllocation" SET state='AVAILABLE' WHERE "transactionId"='sale';
INSERT INTO "TransactionStatusHistory" VALUES ('sale','COMPLETED');
UPDATE "Transaction" SET status='COMPLETED' WHERE id='sale';
UPDATE "CoproductionAllocation" SET state='AVAILABLE' WHERE "transactionId"='sale';
UPDATE "CoproductionAllocation" SET state='LOCKED' WHERE "transactionId"='sale';
UPDATE "CoproductionAllocation" SET state='AVAILABLE' WHERE "transactionId"='sale';
DO $$ BEGIN
 IF (SELECT count(*) FROM "SalePushEvent" WHERE "transactionId"='sale') <> 3 THEN RAISE EXCEPTION 'expected one event per beneficiary'; END IF;
 IF (SELECT amount FROM "SalePushEvent" WHERE "transactionId"='sale' AND "userId"='owner') <> 45.01 THEN RAISE EXCEPTION 'wrong owner net'; END IF;
 IF (SELECT amount FROM "SalePushEvent" WHERE "transactionId"='sale' AND "userId"='a') <> 27 THEN RAISE EXCEPTION 'wrong partner A net'; END IF;
 IF (SELECT amount FROM "SalePushEvent" WHERE "transactionId"='sale' AND "userId"='b') <> 18 THEN RAISE EXCEPTION 'wrong partner B net'; END IF;
 IF (SELECT count(*) FROM "PushDelivery") <> 4 THEN RAISE EXCEPTION 'wrong per-device deliveries'; END IF;
 IF EXISTS (SELECT 1 FROM "PushDelivery" d JOIN "SalePushEvent" e ON e.id=d."eventId" JOIN "PushSubscription" s ON s.id=d."subscriptionId" WHERE e."userId"<>s."userId") THEN RAISE EXCEPTION 'beneficiary privacy failed'; END IF;
 IF (SELECT count(*) FROM "SalePushEvent" WHERE "transactionId"='old') <> 1 THEN RAISE EXCEPTION 'historical notifications changed'; END IF;
END $$;
SAVEPOINT credit;
INSERT INTO "Transaction" (id,"userId",amount,status,"financialSnapshot") VALUES ('rollback','owner',100,'COMPLETED','{"coproduction":{}}');
INSERT INTO "CoproductionAllocation" ("transactionId","userId",amount,state) VALUES ('rollback','a',100,'AVAILABLE');
ROLLBACK TO credit;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "SalePushEvent" WHERE "transactionId"='rollback') THEN RAISE EXCEPTION 'outbox escaped rollback'; END IF; END $$;
INSERT INTO "Transaction" (id,"userId",amount,status,"financialSnapshot") VALUES ('ineligible','owner',100,'COMPLETED','{"coproduction":{}}'),('historical','owner',100,'COMPLETED','{"coproduction":{}}');
UPDATE "Transaction" SET "createdAt"='2020-01-01' WHERE id='historical';
INSERT INTO "CoproductionAllocation" ("transactionId","userId",amount,state) VALUES ('ineligible','pending',50,'AVAILABLE'),('ineligible','inactive',50,'AVAILABLE'),('historical','a',100,'AVAILABLE');
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "SalePushEvent" WHERE "transactionId" IN ('ineligible','historical')) THEN RAISE EXCEPTION 'ineligible/historical notification'; END IF; END $$;
INSERT INTO "Transaction" (id,"userId",amount,status) VALUES ('regular','owner',29.99,'COMPLETED');
INSERT INTO "CoproductionAllocation" ("transactionId","userId",amount,state) VALUES ('regular','a',1,'AVAILABLE');
DO $$ BEGIN IF (SELECT count(*) FROM "SalePushEvent" WHERE "transactionId"='regular') <> 1 THEN RAISE EXCEPTION 'allocation without private snapshot'; END IF; END $$;
DO $$ BEGIN IF (SELECT amount FROM "SalePushEvent" WHERE "transactionId"='regular' AND "userId"='owner') <> 29.99 THEN RAISE EXCEPTION 'regular sale regression'; END IF; END $$;
ROLLBACK;
