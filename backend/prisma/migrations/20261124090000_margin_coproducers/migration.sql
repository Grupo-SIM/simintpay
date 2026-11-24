ALTER TABLE "MarginAffiliateAgreement"
  ADD COLUMN coproducers jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(coproducers) = 'array');
ALTER TABLE "MarginAffiliateRevision"
  ADD COLUMN coproducers jsonb NOT NULL DEFAULT '[]';
