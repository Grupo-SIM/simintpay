-- Change only the default for future platforms; preserve existing owner choices.
ALTER TABLE "Platform" ALTER COLUMN "absorbCustomerInterest" SET DEFAULT true;

-- Correct the known historical 1x interest default without overwriting custom rates.
UPDATE "Platform"
SET "customerInterestRates" = jsonb_set("customerInterestRates", '{1}', '0'::jsonb)
WHERE "customerInterestRates"->>'1' = '0.0152';
UPDATE "PlatformTaxaOverride" SET "value" = 0
WHERE "key" = 'MDR_LINK_1X' AND "value" = 0.0152;
