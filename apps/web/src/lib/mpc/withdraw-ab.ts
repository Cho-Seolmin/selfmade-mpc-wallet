import {
  MPC_CHAIN_PATH,
  MPC_PARTY,
  decodeWireMessages,
  encodeWireMessages,
  filterMessages,
  selectMessages,
} from "@selfmade/mpc-crypto";
import {
  signAbort,
  signComplete,
  signRound1,
  signRound2,
  signRound3,
  signStart,
} from "../../api/wallet";
import { loadBrowserShareABytes } from "./browser-share-store";
import { Keyshare, Message, SignSession, ensureMpcWasm } from "./index";
import { assertWysiwysDigest, type WithdrawAsset } from "./wysiwys";

export type WithdrawAbResult = {
  withdraw: {
    id: string;
    amount: string;
    toAddress: string;
    status: string;
    txHash: string | null;
  };
  message: string;
};

/**
 * Browser party A + Main API party B threshold sign a partial ETH transfer.
 * Share A is loaded from IndexedDB only for this call. Plaintext buffer is
 * zeroized afterwards (best-effort; JS/WASM copies are not fully controllable).
 * Before signing, WYSIWYS recomputes digest from returned tx fields vs UI intent.
 */
export async function withdrawViaAbSigning(params: {
  walletId: string;
  toAddress: string;
  amount: string;
  asset?: WithdrawAsset;
  tokenAddress?: string;
  /** Expected calldata. Native ETH defaults to `0x`. */
  userData?: string;
}): Promise<WithdrawAbResult> {
  await ensureMpcWasm();

  let shareABytes: Uint8Array | null = await loadBrowserShareABytes(
    params.walletId,
  );
  let sessionA: SignSession | null = null;
  let sessionId: string | null = null;

  try {
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const started = await signStart({
      walletId: params.walletId,
      toAddress: params.toAddress,
      amount: params.amount,
      asset: params.asset,
      idempotencyKey,
    });
    sessionId = started.sessionId;

    if (started.alreadyBroadcast) {
      return {
        withdraw: started.withdraw,
        message: started.message,
      };
    }

    if (!started.tx) {
      throw new Error(
        "WYSIWYS: sign/start 응답에 tx 필드가 없습니다. API를 업데이트하세요.",
      );
    }

    const digest = assertWysiwysDigest({
      userToAddress: params.toAddress,
      userAmount: params.amount,
      digestB64: started.digestB64,
      amountWei: started.amountWei,
      tx: started.tx,
      userData: params.userData ?? "0x",
      asset: params.asset,
      tokenAddress: params.tokenAddress,
    });

    const keyshareA = Keyshare.fromBytes(shareABytes);
    shareABytes.fill(0);
    shareABytes = null;
    sessionA = new SignSession(keyshareA, MPC_CHAIN_PATH);

    const msg1ALive = sessionA.createFirstMessage();
    const msg1A = encodeWireMessages([msg1ALive]);
    const msg1All = decodeWireMessages(Message, [started.msg1B, ...msg1A]);
    const msg2ALive = sessionA.handleMessages(
      filterMessages(msg1All, MPC_PARTY.A),
    );
    const msg2A = encodeWireMessages(msg2ALive);

    const round1 = await signRound1(sessionId, msg1A);
    const msg2ForA = decodeWireMessages(Message, [
      ...msg2A,
      ...round1.messagesForA,
    ]);
    const msg3ALive = sessionA.handleMessages(
      selectMessages(msg2ForA, MPC_PARTY.A),
    );
    const msg3A = encodeWireMessages(msg3ALive);

    const round2 = await signRound2(sessionId, msg2A);
    const msg3ForA = decodeWireMessages(Message, [
      ...msg3A,
      ...round2.messagesForA,
    ]);
    sessionA.handleMessages(selectMessages(msg3ForA, MPC_PARTY.A));

    await signRound3(sessionId, msg3A);

    const msg4ALive = sessionA.lastMessage(digest);
    const msg4A = encodeWireMessages([msg4ALive]);

    return await signComplete(sessionId, msg4A);
  } catch (err) {
    if (sessionId) {
      await signAbort(sessionId).catch(() => undefined);
    }
    throw err;
  } finally {
    if (shareABytes) {
      shareABytes.fill(0);
    }
    if (sessionA) {
      try {
        sessionA.free();
      } catch {
        // ignore
      }
    }
  }
}
