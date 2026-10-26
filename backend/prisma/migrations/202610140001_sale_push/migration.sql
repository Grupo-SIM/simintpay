-- Old plans never persisted gateway interval/retry settings; keep unknown values NULL.
ALTER TABLE "Plan" ADD COLUMN frequency INTEGER, ADD COLUMN repetitions INTEGER, ADD COLUMN "retryDays" INTEGER;
-- Outbox created atomically by PostgreSQL for every first sale approval.
CREATE TABLE "PushSubscription" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "endpoint" TEXT NOT NULL UNIQUE, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
CREATE TABLE "SalePushEvent" (
 "id" TEXT PRIMARY KEY, "transactionId" TEXT NOT NULL UNIQUE REFERENCES "Transaction"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "amount" DECIMAL(12,2) NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE "PushDelivery" (
 "id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL REFERENCES "SalePushEvent"("id") ON DELETE CASCADE,
 "subscriptionId" TEXT NOT NULL REFERENCES "PushSubscription"("id") ON DELETE CASCADE,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "error" TEXT,
 UNIQUE("eventId", "subscriptionId")
);
CREATE INDEX "PushDelivery_pending_idx" ON "PushDelivery"("status", "nextAttemptAt");
CREATE TABLE "SalePushActivation" ("startedAt" TIMESTAMPTZ NOT NULL DEFAULT now() PRIMARY KEY);
INSERT INTO "SalePushActivation" DEFAULT VALUES;
-- Record historical approvals solely as suppression markers; never create deliveries.
INSERT INTO "SalePushEvent" (id, "transactionId", "userId", amount)
SELECT 'sale:' || id, id, "userId", amount FROM "Transaction" WHERE status::text = 'COMPLETED';
CREATE FUNCTION capture_sale_push() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id TEXT;
BEGIN
 IF NEW.status::text <> 'COMPLETED' THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' THEN
   IF OLD.status::text = 'COMPLETED' OR EXISTS (SELECT 1 FROM "TransactionStatusHistory" WHERE "transactionId" = NEW.id AND "toStatus"::text = 'COMPLETED') THEN RETURN NEW; END IF;
 ELSE
   -- Historical imports retain their original date and must never alert.
   IF NEW."createdAt" < (SELECT "startedAt" FROM "SalePushActivation" LIMIT 1) THEN RETURN NEW; END IF;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM "User" WHERE id = NEW."userId" AND "clientStatus"::text = 'APPROVED' AND "isActive" AND NOT "isPurged") THEN RETURN NEW; END IF;
 event_id := 'sale:' || NEW.id;
 INSERT INTO "SalePushEvent" (id, "transactionId", "userId", amount) VALUES (event_id, NEW.id, NEW."userId", NEW.amount) ON CONFLICT ("transactionId") DO NOTHING;
 IF FOUND THEN
 INSERT INTO "PushDelivery" (id, "eventId", "subscriptionId")
 SELECT event_id || ':' || id, event_id, id FROM "PushSubscription" WHERE "userId" = NEW."userId" ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER sale_push_approval AFTER INSERT OR UPDATE OF status ON "Transaction" FOR EACH ROW EXECUTE FUNCTION capture_sale_push();
