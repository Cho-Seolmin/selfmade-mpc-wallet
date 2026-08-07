-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'RECOVERY_PENDING', 'RETIRING', 'RETIRED');

-- AlterTable Wallet: lifecycle + MPC Share B fields
ALTER TABLE "Wallet"
  ADD COLUMN "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "mpcPublicKey" TEXT,
  ADD COLUMN "encryptedShareB" TEXT,
  ADD COLUMN "retiredAt" TIMESTAMP(3);

-- Drop legacy one-wallet-per-type unique constraint
DROP INDEX IF EXISTS "Wallet_userId_walletType_key";

-- Allow many RETIRED wallets, but only one non-retired wallet per (userId, walletType)
CREATE UNIQUE INDEX "Wallet_userId_walletType_non_retired_key"
  ON "Wallet" ("userId", "walletType")
  WHERE "status" IN ('ACTIVE', 'RECOVERY_PENDING', 'RETIRING');

CREATE INDEX "Wallet_userId_walletType_status_idx"
  ON "Wallet" ("userId", "walletType", "status");

CREATE INDEX "Wallet_userId_status_idx"
  ON "Wallet" ("userId", "status");

-- Allow wallet-lifecycle audit events without a withdraw request
ALTER TABLE "WithdrawalAuditLog"
  ALTER COLUMN "withdrawRequestId" DROP NOT NULL;
