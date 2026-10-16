-- Order bump / upsell / downsell em links de pagamento. Somente criação de tabelas novas.
CREATE TABLE IF NOT EXISTS "PaymentLinkOffer" (
    "id" TEXT NOT NULL,
    "paymentLinkId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "headline" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "originalPrice" DECIMAL(12,2),
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLinkOffer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentLinkOffer_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PaymentLinkOffer_paymentLinkId_idx" ON "PaymentLinkOffer"("paymentLinkId");

CREATE TABLE IF NOT EXISTS "PaymentLinkOfferSale" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "paymentLinkId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "parentTransactionId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLinkOfferSale_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PaymentLinkOfferSale_transactionId_idx" ON "PaymentLinkOfferSale"("transactionId");
CREATE INDEX IF NOT EXISTS "PaymentLinkOfferSale_parentTransactionId_idx" ON "PaymentLinkOfferSale"("parentTransactionId");
CREATE INDEX IF NOT EXISTS "PaymentLinkOfferSale_offerId_idx" ON "PaymentLinkOfferSale"("offerId");
