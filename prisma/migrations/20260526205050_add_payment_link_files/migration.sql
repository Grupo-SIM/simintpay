-- CreateTable
CREATE TABLE "PaymentLinkFile" (
    "id" TEXT NOT NULL,
    "paymentLinkId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLinkFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentLinkFile_paymentLinkId_idx" ON "PaymentLinkFile"("paymentLinkId");

-- AddForeignKey
ALTER TABLE "PaymentLinkFile" ADD CONSTRAINT "PaymentLinkFile_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
