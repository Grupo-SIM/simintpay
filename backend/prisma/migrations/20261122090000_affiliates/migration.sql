CREATE TABLE "AffiliateAgreement" (
  product text NOT NULL CHECK (product IN ('plataformas', 'ofertas')),
  "productId" text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  "defaultPercentageBps" integer CHECK ("defaultPercentageBps" BETWEEN 1 AND 10000),
  "commissionOnRenewals" boolean,
  "linkBaseUrl" text,
  affiliates jsonb NOT NULL CHECK (jsonb_typeof(affiliates) = 'array'),
  "actorId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product, "productId"),
  CHECK (product = 'ofertas' OR "commissionOnRenewals" IS NOT NULL),
  CHECK (product = 'plataformas' OR "linkBaseUrl" IS NULL)
);
CREATE TABLE "AffiliateAgreementRevision" (
  product text NOT NULL,
  "productId" text NOT NULL,
  version integer NOT NULL,
  "defaultPercentageBps" integer,
  "commissionOnRenewals" boolean,
  "linkBaseUrl" text,
  affiliates jsonb NOT NULL,
  "actorId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product, "productId", version)
);
CREATE TABLE "AffiliateCode" (
  "platformId" text NOT NULL REFERENCES "Platform"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9_-]{3,40}$'),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("platformId", "userId")
);
CREATE UNIQUE INDEX "AffiliateCode_platformId_code_key" ON "AffiliateCode"("platformId", code);
CREATE TABLE "AffiliateAllocation" (
  "transactionId" text NOT NULL REFERENCES "Transaction"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  state text NOT NULL CHECK (state IN ('AVAILABLE', 'LOCKED', 'REVERSED')),
  "isRenewal" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("transactionId", "userId")
);
CREATE INDEX "AffiliateAllocation_userId_idx" ON "AffiliateAllocation"("userId");
