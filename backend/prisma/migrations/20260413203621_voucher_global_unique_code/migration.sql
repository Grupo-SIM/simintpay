/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `Voucher` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Voucher_userId_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");
