export type WalletStatus =
  | "ACTIVE"
  | "RECOVERY_PENDING"
  | "RETIRING"
  | "RETIRED";

export type WalletType = "MPC";

export type Wallet = {
  id: string;
  walletType: WalletType;
  status: WalletStatus;
  address: string;
  mpcPublicKey?: string | null;
  createdAt: string;
  retiredAt?: string | null;
  resolvedAddress?: string;
  addressSource?: string;
};

export type TokenBalance = {
  address: string;
  symbol: string;
  decimals: number;
  balanceRaw: string;
};

export type WalletBalance = {
  walletId: string;
  address: string;
  balanceWei: string;
  status?: WalletStatus;
  tokens?: TokenBalance[];
};

export type WithdrawStatus =
  | "PENDING"
  | "APPROVED"
  | "QUEUED"
  | "PROCESSING"
  | "BROADCASTED"
  | "EXECUTED"
  | "REJECTED"
  | "FAILED"
  | "EXPIRED";

export type WithdrawItem = {
  id: string;
  amount: string;
  toAddress: string;
  status: WithdrawStatus;
  approvedBy: string | null;
  txHash: string | null;
  createdAt: string;
  executionType?: WalletType | null;
  asset?: "ETH" | "ERC20";
  approvalCount?: number;
  requiredApprovalCount?: number | null;
};

export type WalletLimit = {
  walletId: string;
  dailyLimit: string;
  singleTxLimit: string;
};
