-- The offer-level webhook was removed; the platform webhook is the only one.
UPDATE "Offer"
SET "fulfillment" = "fulfillment" - 'webhookUrl'
WHERE "fulfillment" IS NOT NULL AND jsonb_typeof("fulfillment") = 'object' AND "fulfillment" ? 'webhookUrl';
