-- Transaction -> platform association, independent of free-text descriptions.
-- platformTag starts as the [TENANT:x] marker of the description (backfill below, and on every
-- insert that does not provide one) and can be edited afterwards. Tags are stored with hyphens,
-- so ZERO_GRAU and ZERO-GRAU are the same platform.

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "platformTag" text;

CREATE OR REPLACE FUNCTION transaction_canonical_platform_tag(tag text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN tag IS NULL OR btrim(tag) = '' THEN NULL
    WHEN upper(btrim(tag)) = 'EBOOKSIM' THEN 'EBOOK'
    ELSE replace(upper(btrim(tag)), '_', '-')
  END
$$;

CREATE OR REPLACE FUNCTION transaction_platform_tag_from_description(description text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT transaction_canonical_platform_tag((regexp_match(description, '\[TENANT:([^\]]+)\]', 'i'))[1])
$$;

UPDATE "Transaction"
SET "platformTag" = transaction_platform_tag_from_description(description)
WHERE "platformTag" IS NULL
  AND transaction_platform_tag_from_description(description) IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Transaction_platformTag_idx" ON "Transaction" ("platformTag");

CREATE OR REPLACE FUNCTION transaction_platform_tag_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."platformTag" IS NULL THEN
    NEW."platformTag" := transaction_platform_tag_from_description(NEW.description);
  ELSE
    NEW."platformTag" := transaction_canonical_platform_tag(NEW."platformTag");
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS transaction_platform_tag_sync ON "Transaction";
CREATE TRIGGER transaction_platform_tag_sync
  BEFORE INSERT OR UPDATE OF "platformTag" ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION transaction_platform_tag_sync();
