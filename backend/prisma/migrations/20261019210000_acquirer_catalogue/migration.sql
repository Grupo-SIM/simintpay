CREATE TABLE "AcquirerCatalogue" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL
);
-- Include enum-backed processors and every historical policy key, without rewriting history.
INSERT INTO "AcquirerCatalogue" ("code", "name")
SELECT DISTINCT code, code FROM (
  SELECT unnest(enum_range(NULL::"Acquirer"))::text AS code
  UNION SELECT 'DOM'
  UNION SELECT split_part(key, '/', 1)
  FROM "FinancialPolicyRevision", LATERAL jsonb_object_keys(COALESCE("document"->'lanes', '{}'::jsonb)) AS key
  UNION SELECT split_part(key, '/', 1)
  FROM "FinancialPolicyRevision", LATERAL jsonb_object_keys(COALESCE("document"->'owner', '{}'::jsonb)) AS key
) processors WHERE code <> '';
