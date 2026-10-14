-- Run against empty disposable LOCAL PostgreSQL: psql -v ON_ERROR_STOP=1 -f src/modules/sale-push/tests/approval-trigger.sql
CREATE TABLE "User" (id TEXT PRIMARY KEY, "clientStatus" TEXT, "isActive" BOOLEAN DEFAULT true, "isPurged" BOOLEAN DEFAULT false);
CREATE TABLE "Transaction" (id TEXT PRIMARY KEY, "userId" TEXT, amount DECIMAL(12,2), status TEXT, "createdAt" TIMESTAMPTZ DEFAULT now());
CREATE TABLE "Plan" (id TEXT PRIMARY KEY);
CREATE TABLE "TransactionStatusHistory" ("transactionId" TEXT, "toStatus" TEXT);
INSERT INTO "User" VALUES ('client', 'APPROVED', true, false), ('pending', 'PENDING', true, false);
INSERT INTO "Transaction" (id,"userId",amount,status,"createdAt") VALUES ('old-approved','client',29.99,'COMPLETED','2020-01-01');
\ir ../../../../prisma/migrations/202610140001_sale_push/migration.sql
UPDATE "Transaction" SET status='REFUNDED' WHERE id='old-approved';
UPDATE "Transaction" SET status='COMPLETED' WHERE id='old-approved';
INSERT INTO "PushSubscription" (id, "userId", endpoint, p256dh, auth) VALUES ('d1','client','https://one','key','key'), ('d2','client','https://two','key','key');
INSERT INTO "Transaction" (id,"userId",amount,status) VALUES ('pending-sale','client',14.99,'PENDING');
UPDATE "Transaction" SET status='COMPLETED' WHERE id='pending-sale';
UPDATE "Transaction" SET status='COMPLETED' WHERE id='pending-sale';
UPDATE "Transaction" SET status='REFUNDED' WHERE id='pending-sale';
UPDATE "Transaction" SET status='COMPLETED' WHERE id='pending-sale';
INSERT INTO "Transaction" (id,"userId",amount,status) VALUES ('direct-sale','client',29.99,'COMPLETED');
INSERT INTO "Transaction" (id,"userId",amount,status,"createdAt") VALUES ('historical','client',29.99,'COMPLETED','2020-01-01');
INSERT INTO "Transaction" (id,"userId",amount,status) VALUES ('not-approved','pending',29.99,'COMPLETED');
BEGIN;
INSERT INTO "Transaction" (id,"userId",amount,status) VALUES ('rolled-back','client',29.99,'COMPLETED');
ROLLBACK;
DO $$ BEGIN
 IF (SELECT count(*) FROM "SalePushEvent") <> 3 THEN RAISE EXCEPTION 'event idempotency/history/rollback failed'; END IF;
 IF (SELECT count(*) FROM "PushDelivery") <> 4 THEN RAISE EXCEPTION 'per-device unique deliveries failed'; END IF;
END $$;
DELETE FROM "PushSubscription" WHERE id='d1';
DO $$ BEGIN
 IF (SELECT count(*) FROM "PushDelivery") <> 2 THEN RAISE EXCEPTION 'device delete cascade failed'; END IF;
END $$;
