import {
  MPC_PARTIES,
  MPC_PARTY,
  MPC_THRESHOLD,
  base64ToBytes,
  bytesToBase64,
  decodeWireMessages,
  encodeWireMessages,
  filterMessages,
} from "@selfmade/mpc-crypto";
import {
  dkgAbort,
  dkgComplete,
  dkgRound2,
  dkgRound3,
  dkgRound4,
  dkgStart,
} from "../../api/wallet";
import type { Wallet } from "../../types/wallet";
import { KeygenSession, Message, ensureMpcWasm } from "./index";

const SHARE_A_STORAGE_PREFIX = "mpc.shareA.";

/** Temporary Share A persistence until STEP 5 (IndexedDB + AES-GCM). */
export function storeShareATemporary(walletId: string, shareB64: string) {
  sessionStorage.setItem(`${SHARE_A_STORAGE_PREFIX}${walletId}`, shareB64);
}

export function loadShareATemporary(walletId: string): string | null {
  return sessionStorage.getItem(`${SHARE_A_STORAGE_PREFIX}${walletId}`);
}

/**
 * Run browser-side party A through the full 2-of-3 DKG against Main API + Recovery.
 * Returns created wallet and keeps Share A in sessionStorage (STEP 5 hardens storage).
 */
export async function createMpcWalletViaDkg(): Promise<{
  wallet: Wallet;
  shareABase64: string;
}> {
  await ensureMpcWasm();

  const sessionA = new KeygenSession(
    MPC_PARTIES,
    MPC_THRESHOLD,
    MPC_PARTY.A,
  );

  let sessionId: string | null = null;

  try {
    const msg1A = encodeWireMessages([sessionA.createFirstMessage()])[0]!;
    const started = await dkgStart(msg1A);
    sessionId = started.sessionId;

    const peer1 = decodeWireMessages(Message, started.peerRound1Messages);
    const msg2ALive = sessionA.handleMessages(
      filterMessages(peer1, MPC_PARTY.A),
    );
    const commitmentA = bytesToBase64(sessionA.calculateChainCodeCommitment());
    const msg2A = encodeWireMessages(msg2ALive);

    const round2 = await dkgRound2(sessionId, msg2A, commitmentA);
    const msg2ForA = decodeWireMessages(Message, round2.messagesForA);
    const msg3ALive = sessionA.handleMessages(msg2ForA);
    const msg3A = encodeWireMessages(msg3ALive);

    const round3 = await dkgRound3(sessionId, msg3A);
    const msg3ForA = decodeWireMessages(Message, round3.messagesForA);
    const commitments = round3.commitmentsB64.map((c) => base64ToBytes(c));
    const msg4ALive = sessionA.handleMessages(msg3ForA, commitments as never);
    const msg4A = encodeWireMessages(msg4ALive);

    const round4 = await dkgRound4(sessionId, msg4A);
    const msg4ForA = decodeWireMessages(Message, round4.messagesForA);
    sessionA.handleMessages(filterMessages(msg4ForA, MPC_PARTY.A));

    const shareA = sessionA.keyshare();
    const shareABase64 = bytesToBase64(shareA.toBytes());
    shareA.free();

    const completed = await dkgComplete(sessionId);
    storeShareATemporary(completed.wallet.id, shareABase64);

  return {
    wallet: completed.wallet,
    shareABase64,
  };
  } catch (error) {
    if (sessionId) {
      await dkgAbort(sessionId).catch(() => undefined);
    }
    try {
      sessionA.free();
    } catch {
      // session may already be consumed by keyshare()
    }
    throw error;
  }
}
