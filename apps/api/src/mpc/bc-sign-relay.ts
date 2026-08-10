import {
  MPC_CHAIN_PATH,
  MPC_PARTY,
  base64ToBytes,
  buildEcdsaSignature,
  bytesToBase64,
  decodeWireMessages,
  encodeWireMessages,
  filterMessages,
  selectMessages,
  type MpcEcdsaSignature,
  type MpcWireMessage,
} from '@selfmade/mpc-crypto';
import { Keyshare, Message, SignSession } from './wasm';
import type { RecoveryClientService } from './recovery-client.service';

type SignRelayClient = Pick<
  RecoveryClientService,
  | 'signStart'
  | 'signRound1'
  | 'signRound2'
  | 'signRound3'
  | 'signLast'
  | 'signAbort'
>;

/**
 * Drive party B through B+C threshold sign against Recovery party C.
 * Share B stays in this process; Share C never leaves Recovery (wire only).
 */
export async function signDigestBcRelay(params: {
  shareBBytes: Uint8Array;
  digest32: Uint8Array;
  walletId: string;
  expectedAddress: string;
  recovery: SignRelayClient;
}): Promise<MpcEcdsaSignature> {
  if (params.digest32.length !== 32) {
    throw new Error('digest32 must be exactly 32 bytes');
  }

  let sessionB: SignSession | null = null;
  let sessionId: string | null = null;
  const shareCopy = new Uint8Array(params.shareBBytes);

  try {
    const started = await params.recovery.signStart({
      walletId: params.walletId,
      digestB64: bytesToBase64(params.digest32),
    });
    sessionId = started.sessionId;

    const keyshareB = Keyshare.fromBytes(shareCopy);
    shareCopy.fill(0);
    sessionB = new SignSession(keyshareB, MPC_CHAIN_PATH);

    const msg1B = encodeWireMessages([sessionB.createFirstMessage()]);
    const msg1All = decodeWireMessages(Message, [
      started.msg1C as MpcWireMessage,
      ...msg1B,
    ]);
    const msg2B = encodeWireMessages(
      sessionB.handleMessages(filterMessages(msg1All, MPC_PARTY.B)),
    );

    const r1 = await params.recovery.signRound1(sessionId, msg1B);
    const msg3B = encodeWireMessages(
      sessionB.handleMessages(
        selectMessages(
          decodeWireMessages(Message, [
            ...msg2B,
            ...(r1.messages as MpcWireMessage[]),
          ]),
          MPC_PARTY.B,
        ),
      ),
    );

    const r2 = await params.recovery.signRound2(sessionId, msg2B);
    sessionB.handleMessages(
      selectMessages(
        decodeWireMessages(Message, [
          ...msg3B,
          ...(r2.messages as MpcWireMessage[]),
        ]),
        MPC_PARTY.B,
      ),
    );

    await params.recovery.signRound3(sessionId, msg3B);

    const msg4B = encodeWireMessages([sessionB.lastMessage(params.digest32)]);
    const last = await params.recovery.signLast(sessionId);
    sessionId = null; // Recovery already closed the session

    const allMsg4 = decodeWireMessages(Message, [
      ...msg4B,
      ...(last.messages as MpcWireMessage[]),
    ]);
    const [r, s] = sessionB.combine(filterMessages(allMsg4, MPC_PARTY.B));
    return buildEcdsaSignature(
      params.digest32,
      r,
      s,
      params.expectedAddress,
    );
  } catch (err) {
    if (sessionId) {
      await params.recovery.signAbort(sessionId).catch(() => undefined);
    }
    throw err;
  } finally {
    shareCopy.fill(0);
    if (sessionB) {
      try {
        sessionB.free();
      } catch {
        // ignore
      }
    }
  }
}
