-- Reinscrições do mesmo pedido passam a acrescentar tokens de capability
-- (com data de emissão) em vez de invalidar os já emitidos.
ALTER TABLE "EbookSettlement"
  ADD COLUMN "capabilityHashes" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "EbookSettlement"
SET "capabilityHashes" = jsonb_build_array(
  jsonb_build_object('hash', "capabilityHash", 'issuedAt', "updatedAt")
);
