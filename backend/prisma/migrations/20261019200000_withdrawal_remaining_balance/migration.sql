-- Historical balances cannot be reconstructed from current wallets.
ALTER TABLE "WithdrawRequest" ADD COLUMN "remainingBalanceAfterWithdrawal" DECIMAL(12,2);
