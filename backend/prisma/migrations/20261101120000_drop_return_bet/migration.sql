-- Remove the unused Return Bet tables. Refuse to run if they hold any data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ReturnBetAccount") THEN
    RAISE EXCEPTION 'ReturnBetAccount is not empty; refusing to drop it';
  END IF;
  IF EXISTS (SELECT 1 FROM "ReturnBetWithdrawalPolicy") THEN
    RAISE EXCEPTION 'ReturnBetWithdrawalPolicy is not empty; refusing to drop it';
  END IF;
END $$;

-- DropTable
DROP TABLE "ReturnBetAccount";

-- DropTable
DROP TABLE "ReturnBetWithdrawalPolicy";
