import { getBytes, keccak256 } from 'ethers';
import {
  MPC_CHAIN_PATH,
  MPC_PARTY,
  base64ToBytes,
  bytesToBase64,
  decodeWireMessages,
  encodeWireMessages,
  ethAddressFromPublicKey,
  filterMessages,
  runInProcessDkg,
  selectMessages,
  type MpcWireMessage,
} from '@selfmade/mpc-crypto';
import { signDigestBcRelay } from './bc-sign-relay';
import { KeygenSession, Keyshare, Message, SignSession } from './wasm';

/**
 * In-memory party-C SignSession that mirrors Recovery SignService
 * (Share C never leaves this fake "recovery" process as bytes over the API).
 */
function createInMemoryPartyC(shareCBytes: Uint8Array) {
  type State = {
    stateB64: string;
    msg1C: MpcWireMessage;
    msg2C?: MpcWireMessage[];
    msg3C?: MpcWireMessage[];
    digestB64: string;
    step: string;
  };
  const sessions = new Map<string, State>();

  return {
    async signStart(params: { walletId: string; digestB64: string }) {
      const keyshare = Keyshare.fromBytes(new Uint8Array(shareCBytes));
      const session = new SignSession(keyshare, MPC_CHAIN_PATH);
      const msg1C = encodeWireMessages([session.createFirstMessage()])[0]!;
      const sessionId = `c-test-${sessions.size + 1}`;
      sessions.set(sessionId, {
        stateB64: bytesToBase64(session.toBytes()),
        msg1C,
        digestB64: params.digestB64,
        step: 'WAIT_MSG1B',
      });
      session.free();
      return {
        sessionId,
        walletId: params.walletId,
        partyId: MPC_PARTY.C,
        msg1C,
      };
    },
    async signRound1(sessionId: string, msg1B: MpcWireMessage[]) {
      const state = sessions.get(sessionId)!;
      const session = SignSession.fromBytes(base64ToBytes(state.stateB64));
      try {
        const all = decodeWireMessages(Message, [state.msg1C, ...msg1B]);
        state.msg2C = encodeWireMessages(
          session.handleMessages(filterMessages(all, MPC_PARTY.C)),
        );
        state.stateB64 = bytesToBase64(session.toBytes());
        state.step = 'WAIT_MSG2B';
        return { sessionId, messages: state.msg2C };
      } finally {
        session.free();
      }
    },
    async signRound2(sessionId: string, msg2B: MpcWireMessage[]) {
      const state = sessions.get(sessionId)!;
      const session = SignSession.fromBytes(base64ToBytes(state.stateB64));
      try {
        const all = decodeWireMessages(Message, [...msg2B, ...state.msg2C!]);
        state.msg3C = encodeWireMessages(
          session.handleMessages(selectMessages(all, MPC_PARTY.C)),
        );
        state.stateB64 = bytesToBase64(session.toBytes());
        state.step = 'WAIT_MSG3B';
        return { sessionId, messages: state.msg3C };
      } finally {
        session.free();
      }
    },
    async signRound3(sessionId: string, msg3B: MpcWireMessage[]) {
      const state = sessions.get(sessionId)!;
      const session = SignSession.fromBytes(base64ToBytes(state.stateB64));
      try {
        const all = decodeWireMessages(Message, [...msg3B, ...state.msg3C!]);
        session.handleMessages(selectMessages(all, MPC_PARTY.C));
        state.stateB64 = bytesToBase64(session.toBytes());
        state.step = 'WAIT_LAST';
        return { sessionId, ok: true as const };
      } finally {
        session.free();
      }
    },
    async signLast(sessionId: string) {
      const state = sessions.get(sessionId)!;
      const session = SignSession.fromBytes(base64ToBytes(state.stateB64));
      try {
        const msg4C = encodeWireMessages([
          session.lastMessage(base64ToBytes(state.digestB64)),
        ]);
        sessions.delete(sessionId);
        return { sessionId, messages: msg4C };
      } finally {
        session.free();
      }
    },
    async signAbort(sessionId: string) {
      sessions.delete(sessionId);
      return { ok: true as const };
    },
  };
}

describe('signDigestBcRelay', () => {
  it('produces a valid ECDSA signature without moving Share C bytes to the caller', async () => {
    const shares = runInProcessDkg(KeygenSession, {
      participants: 3,
      threshold: 2,
    });
    try {
      const b = shares.find((s) => s.partyId === MPC_PARTY.B)!;
      const c = shares.find((s) => s.partyId === MPC_PARTY.C)!;
      const address = ethAddressFromPublicKey(b.publicKey);
      const shareBBytes = new Uint8Array(b.toBytes());
      const shareCBytes = new Uint8Array(c.toBytes());
      const digest = getBytes(
        keccak256(Buffer.from('bc-relay-sign-test-digest')),
      );

      const recovery = createInMemoryPartyC(shareCBytes);
      const signature = await signDigestBcRelay({
        shareBBytes,
        digest32: digest,
        walletId: 'w-test',
        expectedAddress: address,
        recovery: recovery as any,
      });

      expect(signature.r).toHaveLength(32);
      expect(signature.s).toHaveLength(32);
      expect([27, 28]).toContain(signature.v);
    } finally {
      shares.forEach((s) => s.free());
    }
  });
});
