import { api } from "./axios";
import type { Wallet } from "../types/wallet";

export type WireMessage = {
  from: number;
  to?: number;
  payloadB64: string;
};

export async function getWallets() {
  const res = await api.get("/wallets");
  return res.data as Wallet[];
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

export async function dkgStart(message: WireMessage) {
  const res = await api.post("/wallets/mpc/dkg/start", { message });
  return res.data as {
    sessionId: string;
    walletId: string;
    partyId: number;
    peerRound1Messages: WireMessage[];
  };
}

export async function dkgRound2(
  sessionId: string,
  messages: WireMessage[],
  commitmentB64: string,
) {
  const res = await api.post(`/wallets/mpc/dkg/${sessionId}/round2`, {
    messages,
    commitmentB64,
  });
  return res.data as {
    sessionId: string;
    messagesForA: WireMessage[];
  };
}

export async function dkgRound3(sessionId: string, messages: WireMessage[]) {
  const res = await api.post(`/wallets/mpc/dkg/${sessionId}/round3`, {
    messages,
  });
  return res.data as {
    sessionId: string;
    messagesForA: WireMessage[];
    commitmentsB64: string[];
  };
}

export async function dkgRound4(sessionId: string, messages: WireMessage[]) {
  const res = await api.post(`/wallets/mpc/dkg/${sessionId}/round4`, {
    messages,
  });
  return res.data as {
    sessionId: string;
    messagesForA: WireMessage[];
  };
}

export async function dkgComplete(sessionId: string) {
  const res = await api.post(`/wallets/mpc/dkg/${sessionId}/complete`);
  return res.data as {
    wallet: Wallet;
    partyId: number;
  };
}

export async function dkgAbort(sessionId: string) {
  const res = await api.post(`/wallets/mpc/dkg/${sessionId}/abort`);
  return res.data;
}
