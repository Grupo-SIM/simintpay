-- Audit trail for admin "access as" (impersonation) token issuance.
CREATE TABLE "AdminAccessLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAccessLog_adminId_idx" ON "AdminAccessLog"("adminId");
CREATE INDEX "AdminAccessLog_targetUserId_idx" ON "AdminAccessLog"("targetUserId");
CREATE INDEX "AdminAccessLog_createdAt_idx" ON "AdminAccessLog"("createdAt");
