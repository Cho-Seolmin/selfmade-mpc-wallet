import { api } from "./axios";
import type { Wallet, WalletBalance } from "../types/wallet";

export type WireMessage = {
  from: number;
  to?: number;
  payloadB64: string;
};

export async function getWallets() {
  const res = await api.get("/wallets");
  return res.data as Wallet[];
}

/** Retired wallet metadata (no secrets). */
export async function getRetiredWallets() {
  const res = await api.get("/wallets/retired");
  return res.data as Wallet[];
}

export async function getWalletSummary() {
  const res = await api.get("/wallets/summary");
  return res.data as {
    walletCount: number;
    totalBalanceWei: string;
    pendingWithdrawCount: number;
    completedWithdrawCount: number;
    retiredWalletCount: number;
    latestRetired: {
      id: string;
      address: string;
      retiredAt: string | null;
    } | null;
    canCreateMpcWallet: boolean;
  };
}

export async function getWalletBalance(walletId: string) {
  const res = await api.get(`/wallets/${walletId}/balance`);
  return res.data as WalletBalance;
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

/** Start normal A+B threshold signing (partial ETH withdraw). */
export async function signStart(params: {
  walletId: string;
  toAddress: string;
  amount: string;
  asset?: "ETH" | "ERC20";
  idempotencyKey: string;
}) {
  const res = await api.post(
    "/wallets/mpc/sign/start",
    {
      walletId: params.walletId,
      toAddress: params.toAddress,
      amount: params.amount,
      ...(params.asset ? { asset: params.asset } : {}),
    },
    {
      headers: {
        "Idempotency-Key": params.idempotencyKey,
      },
    },
  );
  return res.data as
    | {
        alreadyBroadcast: true;
        sessionId: string;
        walletId: string;
        amountWei: string;
        toAddress: string;
        withdraw: {
          id: string;
          amount: string;
          toAddress: string;
          status: "BROADCASTED" | "EXECUTED";
          txHash: string | null;
        };
        message: string;
      }
    | {
        alreadyBroadcast?: false;
        sessionId: string;
        walletId: string;
        digestB64: string;
        msg1B: WireMessage;
        amountWei: string;
        feeWei: string;
        toAddress: string;
        fromAddress: string;
        tx: {
          to: string;
          value: string;
          nonce: number;
          gasLimit: string;
          maxFeePerGas: string;
          maxPriorityFeePerGas: string;
          chainId: string;
          data?: string;
        };
        reused?: boolean;
      };
}

export async function signRound1(sessionId: string, messages: WireMessage[]) {
  const res = await api.post(`/wallets/mpc/sign/${sessionId}/round1`, {
    messages,
  });
  return res.data as { sessionId: string; messagesForA: WireMessage[] };
}

export async function signRound2(sessionId: string, messages: WireMessage[]) {
  const res = await api.post(`/wallets/mpc/sign/${sessionId}/round2`, {
    messages,
  });
  return res.data as { sessionId: string; messagesForA: WireMessage[] };
}

export async function signRound3(sessionId: string, messages: WireMessage[]) {
  const res = await api.post(`/wallets/mpc/sign/${sessionId}/round3`, {
    messages,
  });
  return res.data as { sessionId: string; ok: true };
}

export async function signComplete(sessionId: string, messages: WireMessage[]) {
  const res = await api.post(`/wallets/mpc/sign/${sessionId}/complete`, {
    messages,
  });
  return res.data as {
    withdraw: {
      id: string;
      amount: string;
      toAddress: string;
      status: string;
      txHash: string | null;
    };
    message: string;
  };
}

export async function signAbort(sessionId: string) {
  const res = await api.post(`/wallets/mpc/sign/${sessionId}/abort`);
  return res.data;
}

/** Google OTP gate → wallet status RECOVERY_PENDING (B+C withdraw comes later). */
export async function startEmergencyRecovery(walletId: string, otp: string) {
  const res = await api.post(`/wallets/${walletId}/emergency/start`, { otp });
  return res.data as {
    wallet: Wallet;
    message: string;
  };
}

/** Undo emergency/start: RECOVERY_PENDING → ACTIVE. */
export async function cancelEmergencyRecovery(walletId: string) {
  const res = await api.post(`/wallets/${walletId}/emergency/cancel`);
  return res.data as {
    wallet: Wallet;
    message: string;
  };
}

/** B+C full-balance last withdraw → RETIRED. */
export async function emergencyLastWithdraw(
  walletId: string,
  params: { toAddress: string; otp: string },
) {
  const res = await api.post(`/wallets/${walletId}/emergency/last-withdraw`, params);
  return res.data as {
    wallet: Wallet;
    withdraw: {
      id: string;
      amount: string;
      toAddress: string;
      status: string;
      txHash: string | null;
    };
    tokenWithdraw: {
      amount: string;
      toAddress: string;
      status: string;
      txHash: string | null;
    } | null;
    message: string;
  };
}

/** Report non-sensitive browser lifecycle audit (no Share/PIN). */
export async function reportWalletAuditEvent(
  walletId: string,
  body: {
    eventType: "RECOVERY_FILE_CREATED" | "BROWSER_SHARE_RECOVERED";
    message?: string;
    data?: Record<string, unknown>;
  },
) {
  const res = await api.post(`/wallets/${walletId}/audit-events`, body);
  return res.data as { ok: true; eventType: string };
}

export async function getWalletAudits(walletId: string, take = 50) {
  const res = await api.get(`/wallets/${walletId}/audits`, {
    params: { take },
  });
  return res.data as Array<{
    id: string;
    eventType: string;
    actorType: string;
    message: string | null;
    data: unknown;
    createdAt: string;
  }>;
}
