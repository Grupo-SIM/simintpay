-- Material de entrega por oferta. Somente coluna nova (nula) e tabela nova.
ALTER TABLE "PaymentLinkOffer" ADD COLUMN IF NOT EXISTS "emailBody" TEXT;

CREATE TABLE IF NOT EXISTS "PaymentLinkOfferFile" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLinkOfferFile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentLinkOfferFile_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PaymentLinkOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PaymentLinkOfferFile_offerId_idx" ON "PaymentLinkOfferFile"("offerId");
