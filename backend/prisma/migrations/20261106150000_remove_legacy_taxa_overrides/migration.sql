-- Payment rates are now managed exclusively by FinancialPolicyRevision.
-- Preserve historical policy revisions and transaction snapshots.
DELETE FROM "PlatformTaxaOverride"
WHERE "key" NOT IN ('SAQUE_MIN', 'TAXA_SAQUE_EXTRA')
   OR "tag" LIKE 'CLIENT:%'
   OR "tag" LIKE 'USER:%';
