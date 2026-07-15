-- CreateEnum
CREATE TYPE "CobrancaMode" AS ENUM ('DEBIT', 'PAYABLE');

-- CreateEnum
CREATE TYPE "CobrancaStatus" AS ENUM ('APPLIED', 'PENDING', 'PAID', 'CANCELED');

-- CreateTable
CREATE TABLE "Cobranca" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "mode" "CobrancaMode" NOT NULL DEFAULT 'DEBIT',
    "status" "CobrancaStatus" NOT NULL DEFAULT 'APPLIED',
    "createdByUserId" TEXT NOT NULL,
    "saldoAntes" DECIMAL(12,2),
    "saldoDepois" DECIMAL(12,2),
    "ficouNegativo" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3),
    "paymentRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cobranca_userId_idx" ON "Cobranca"("userId");

-- CreateIndex
CREATE INDEX "Cobranca_status_idx" ON "Cobranca"("status");

-- CreateIndex
CREATE INDEX "Cobranca_createdAt_idx" ON "Cobranca"("createdAt");

-- AddForeignKey
ALTER TABLE "Cobranca" ADD CONSTRAINT "Cobranca_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
