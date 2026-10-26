CREATE TABLE "ReturnBetWithdrawalPolicy" (
    "id" TEXT NOT NULL,
    "minimumGrossAmount" DECIMAL(12,2) NOT NULL DEFAULT 100,
    "fixedWithdrawalFee" DECIMAL(12,2) NOT NULL DEFAULT 2,
    "withdrawalWindowDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReturnBetWithdrawalPolicy_pkey" PRIMARY KEY ("id")
);
