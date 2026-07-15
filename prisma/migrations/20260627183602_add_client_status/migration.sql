-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clientApprovedAt" TIMESTAMP(3),
ADD COLUMN     "clientStatus" "ClientStatus";

-- CreateIndex
CREATE INDEX "User_clientStatus_idx" ON "User"("clientStatus");
