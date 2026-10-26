-- A sale has one private notification event for each beneficiary.
ALTER TABLE "SalePushEvent" DROP CONSTRAINT IF EXISTS "SalePushEvent_transactionId_key";
DROP INDEX IF EXISTS "SalePushEvent_transactionId_key";
CREATE UNIQUE INDEX "SalePushEvent_transactionId_userId_key" ON "SalePushEvent"("transactionId", "userId");

CREATE FUNCTION enqueue_sale_push(sale_id text, beneficiary_id text, credited_amount numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE event_id text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "User" WHERE id = beneficiary_id AND "clientStatus"::text = 'APPROVED' AND "isActive" AND NOT "isPurged") THEN RETURN; END IF;
 event_id := 'sale:' || length(sale_id)::text || ':' || sale_id || ':' || beneficiary_id;
 INSERT INTO "SalePushEvent" (id, "transactionId", "userId", amount)
 VALUES (event_id, sale_id, beneficiary_id, credited_amount)
 ON CONFLICT ("transactionId", "userId") DO NOTHING;
 IF FOUND THEN
  INSERT INTO "PushDelivery" (id, "eventId", "subscriptionId")
  SELECT event_id || ':' || id, event_id, id FROM "PushSubscription" WHERE "userId" = beneficiary_id
  ON CONFLICT DO NOTHING;
 END IF;
END;
$$;

CREATE OR REPLACE FUNCTION capture_sale_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status::text <> 'COMPLETED' THEN RETURN NEW; END IF;
 -- Coproduction is announced after the exact allocations and wallet credits exist.
 IF NEW."financialSnapshot" ? 'coproduction' THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' THEN
  IF OLD.status::text = 'COMPLETED' OR EXISTS (SELECT 1 FROM "TransactionStatusHistory" WHERE "transactionId" = NEW.id AND "toStatus"::text = 'COMPLETED') THEN RETURN NEW; END IF;
 ELSIF NEW."createdAt" < (SELECT "startedAt" FROM "SalePushActivation" LIMIT 1) THEN RETURN NEW;
 END IF;
 PERFORM enqueue_sale_push(NEW.id, NEW."userId", NEW.amount);
 RETURN NEW;
END;
$$;

CREATE FUNCTION capture_coproduction_push() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale "Transaction"%ROWTYPE;
BEGIN
 IF NEW.state <> 'AVAILABLE' THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' THEN
  -- Releasing mediation is not a new sale.
  IF OLD.state <> 'REVERSED' THEN RETURN NEW; END IF;
 END IF;
 SELECT * INTO sale FROM "Transaction" WHERE id = NEW."transactionId";
 IF sale.status::text <> 'COMPLETED' OR NOT coalesce(sale."financialSnapshot" ? 'coproduction', false) THEN RETURN NEW; END IF;
 IF sale."createdAt" < (SELECT "startedAt" FROM "SalePushActivation" LIMIT 1) THEN RETURN NEW; END IF;
 IF EXISTS (SELECT 1 FROM "TransactionStatusHistory" WHERE "transactionId" = sale.id AND "toStatus"::text = 'COMPLETED') THEN RETURN NEW; END IF;
 PERFORM enqueue_sale_push(sale.id, NEW."userId", NEW.amount);
 RETURN NEW;
END;
$$;
CREATE TRIGGER coproduction_push_credit AFTER INSERT OR UPDATE OF state ON "CoproductionAllocation"
FOR EACH ROW EXECUTE FUNCTION capture_coproduction_push();
