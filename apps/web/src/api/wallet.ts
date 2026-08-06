import { api } from "./axios";

export async function getWallets() {
  const res = await api.get("/wallets");
  return res.data;
}

export async function getWalletSummary() {
  const res = await api.get("/wallets/summary");
  return res.data as {
    walletCount: number;
    totalBalanceWei: string;
    pendingWithdrawCount: number;
    completedWithdrawCount: number;
  };
}

export async function getWalletBalance(walletId: string) {
  const res = await api.get(`/wallets/${walletId}/balance`);
  return res.data;
}

export async function getWalletWithdraws(walletId: string, status?: string) {
  const url = status
    ? `/wallets/${walletId}/withdraws?status=${status}`
    : `/wallets/${walletId}/withdraws`;

  const res = await api.get(url);
  return res.data;
}

export async function getWalletLimits(walletId: string) {
  const res = await api.get(`/wallets/${walletId}/limits`);
  return res.data;
}
