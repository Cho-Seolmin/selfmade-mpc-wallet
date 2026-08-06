export type Wallet = {
  id: string;
  walletType: WalletType;
  address: string;
  createdAt: string;
  resolvedAddress?: string;
  addressSource?: string;
};

export type WalletBalance = {
  walletId: string;
  address: string;
  balanceWei: string;
};

export type WithdrawStatus =
  | "PENDING"
  | "APPROVED"
  | "QUEUED"
  | "PROCESSING"
  | "EXECUTED"
  | "REJECTED"
  | "FAILED"
  | "EXPIRED";

export type WalletType = "MPC";

export type WithdrawItem = {
  id: string;
  amount: string;
  toAddress: string;
  status: WithdrawStatus;
  approvedBy: string | null;
  txHash: string | null;
  createdAt: string;
  executionType?: WalletType | null;
  approvalCount?: number;
  requiredApprovalCount?: number | null;
};

export type WalletLimit = {
  walletId: string;
  dailyLimit: string;
  singleTxLimit: string;
};
