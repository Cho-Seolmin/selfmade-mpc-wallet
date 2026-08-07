-- CreateTable
CREATE TABLE "MpcRecoveryShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partyId" INTEGER NOT NULL DEFAULT 2,
    "mpcPublicKey" TEXT NOT NULL,
    "encryptedShareC" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "MpcRecoveryShare_walletId_key" ON "MpcRecoveryShare"("walletId");

-- CreateIndex
CREATE INDEX "MpcRecoveryShare_userId_status_idx" ON "MpcRecoveryShare"("userId", "status");
