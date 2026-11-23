CREATE TABLE "MarginAffiliateAgreement" (
  product text NOT NULL CHECK (product IN ('plataformas', 'ofertas')),
  "productId" text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  "defaultPercentageBps" integer CHECK ("defaultPercentageBps" BETWEEN 1 AND 10000),
  "commissionOnRenewals" boolean,
  affiliates jsonb NOT NULL CHECK (jsonb_typeof(affiliates) = 'array'),
  "actorId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product, "productId"),
  CHECK (product = 'ofertas' OR "commissionOnRenewals" IS NOT NULL)
);
CREATE TABLE "MarginAffiliateRevision" (
  product text NOT NULL,
  "productId" text NOT NULL,
  version integer NOT NULL,
  "defaultPercentageBps" integer,
  "commissionOnRenewals" boolean,
  affiliates jsonb NOT NULL,
  "actorId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product, "productId", version)
);
CREATE TABLE "MarginAffiliateAllocation" (
  "transactionId" text NOT NULL REFERENCES "Transaction"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  state text NOT NULL CHECK (state IN ('AVAILABLE', 'LOCKED', 'REVERSED')),
  "isRenewal" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("transactionId", "userId")
);
CREATE INDEX "MarginAffiliateAllocation_userId_idx" ON "MarginAffiliateAllocation"("userId");
