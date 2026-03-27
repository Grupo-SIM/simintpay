-- AlterTable
ALTER TABLE "User" ADD COLUMN "cpf" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");
