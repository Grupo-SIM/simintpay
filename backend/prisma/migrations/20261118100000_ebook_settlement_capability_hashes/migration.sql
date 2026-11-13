-- Reinscrições do mesmo pedido passam a acrescentar tokens de capability
-- em vez de invalidar os já emitidos.
ALTER TABLE "EbookSettlement"
  ADD COLUMN "capabilityHashes" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "EbookSettlement"
SET "capabilityHashes" = ARRAY["capabilityHash"]
WHERE cardinality("capabilityHashes") = 0;
