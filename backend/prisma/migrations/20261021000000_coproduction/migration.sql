CREATE TABLE "CoproductionAgreement" (
  product text NOT NULL CHECK (product IN ('links-pagamento', 'links-assinatura', 'boletos', 'planos', 'planos-pix')),
  "productId" text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  participants jsonb NOT NULL CHECK (jsonb_typeof(participants) = 'array'),
  "actorId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product, "productId")
);
CREATE TABLE "CoproductionRevision" (
  product text NOT NULL,
  "productId" text NOT NULL,
  version integer NOT NULL,
  participants jsonb NOT NULL,
  "actorId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product, "productId", version)
);
CREATE TABLE "CoproductionAllocation" (
  "transactionId" text NOT NULL REFERENCES "Transaction"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  state text NOT NULL CHECK (state IN ('AVAILABLE', 'LOCKED', 'REVERSED')),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("transactionId", "userId")
);
CREATE INDEX "CoproductionAllocation_userId_idx" ON "CoproductionAllocation"("userId");
