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
  reportWalletAuditEvent,
} from "../../api/wallet";
import type { Wallet } from "../../types/wallet";
import { assertRecoveryPin } from "./browser-crypto";
import {
  clearLegacySessionShareA,
  saveBrowserShareA,
} from "./browser-share-store";
import { KeygenSession, Message, ensureMpcWasm } from "./index";
import {
  createRecoveryFile,
  downloadRecoveryFile,
  type MpcRecoveryFile,
} from "./recovery-file";

export type CreateMpcWalletResult = {
  wallet: Wallet;
  recoveryFile: MpcRecoveryFile;
};

/**
 * Run browser-side party A through 2-of-3 DKG, then:
 * 1) encrypt Share A into IndexedDB (device AES key)
 * 2) build PIN-encrypted Recovery File and trigger download
 *
 * Plaintext Share A is only held ephemerally in memory during this function.
 */
export async function createMpcWalletViaDkg(params: {
  recoveryPin: string;
}): Promise<CreateMpcWalletResult> {
  assertRecoveryPin(params.recoveryPin);
  await ensureMpcWasm();

  const sessionA = new KeygenSession(
    MPC_PARTIES,
    MPC_THRESHOLD,
    MPC_PARTY.A,
  );

  let sessionId: string | null = null;
  let shareABytes: Uint8Array | null = null;

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
    shareABytes = new Uint8Array(shareA.toBytes());
    shareA.free();

    const completed = await dkgComplete(sessionId);
    const wallet = completed.wallet;
    const publicKeyHex = wallet.mpcPublicKey ?? "";

    if (!publicKeyHex) {
      throw new Error("지갑 public key가 없습니다.");
    }

    await saveBrowserShareA({
      walletId: wallet.id,
      address: wallet.address,
      publicKeyHex,
      shareABytes,
    });
    clearLegacySessionShareA(wallet.id);

    const recoveryFile = await createRecoveryFile({
      walletId: wallet.id,
      address: wallet.address,
      publicKeyHex,
      shareABytes,
      pin: params.recoveryPin,
    });
    downloadRecoveryFile(recoveryFile);

    await reportWalletAuditEvent(wallet.id, {
      eventType: "RECOVERY_FILE_CREATED",
      data: { scheme: recoveryFile.scheme, version: recoveryFile.version },
    }).catch(() => undefined);

    return { wallet, recoveryFile };
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
  } finally {
    // Best-effort wipe of ephemeral plaintext buffer.
    if (shareABytes) {
      shareABytes.fill(0);
    }
  }
}
