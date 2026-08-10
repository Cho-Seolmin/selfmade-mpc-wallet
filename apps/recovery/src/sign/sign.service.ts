import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SharesService } from '../shares/shares.service';
import { Keyshare, Message, SignSession } from '../mpc/wasm';
import {
  MPC_CHAIN_PATH,
  MPC_PARTY_C,
  base64ToBytes,
  bytesToBase64,
  decodeWireMessages,
  encodeWireMessages,
  filterMessages,
  selectMessages,
  type WireMessage,
} from '../mpc/wire';

type SignSessionState = {
  sessionId: string;
  walletId: string;
  stateB64: string;
  msg1C: WireMessage;
  msg2C?: WireMessage[];
  msg3C?: WireMessage[];
  digestB64: string;
  step: 'WAIT_MSG1B' | 'WAIT_MSG2B' | 'WAIT_MSG3B' | 'WAIT_LAST' | 'DONE';
  createdAt: number;
};

const SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * Party C SignSession for emergency B+C.
 * Share C never leaves this process — only wire messages are returned.
 */
@Injectable()
export class SignService {
  private readonly sessions = new Map<string, SignSessionState>();

  constructor(private readonly shares: SharesService) {}

  async start(walletId: string, digestB64: string) {
    this.gc();
    const digest = base64ToBytes(digestB64);
    if (digest.length !== 32) {
      throw new BadRequestException('digestB64 must decode to 32 bytes');
    }

    const shareC = await this.shares.loadActiveShareCBytes(walletId);
    let session: SignSession | null = null;
    try {
      const keyshare = Keyshare.fromBytes(new Uint8Array(shareC));
      shareC.fill(0);
      session = new SignSession(keyshare, MPC_CHAIN_PATH);
      const msg1CLive = session.createFirstMessage();
      const msg1C = encodeWireMessages([msg1CLive as any])[0]!;
      const sessionId = `c${randomBytes(16).toString('hex')}`;

      this.sessions.set(sessionId, {
        sessionId,
        walletId,
        stateB64: bytesToBase64(session.toBytes()),
        msg1C,
        digestB64,
        step: 'WAIT_MSG1B',
        createdAt: Date.now(),
      });
      session.free();
      session = null;

      return {
        sessionId,
        walletId,
        partyId: MPC_PARTY_C,
        msg1C,
      };
    } finally {
      shareC.fill(0);
      if (session) {
        try {
          session.free();
        } catch {
          // ignore
        }
      }
    }
  }

  /** Main sends msg1B → return msg2C. */
  round1(sessionId: string, msg1B: WireMessage[]) {
    const state = this.require(sessionId);
    if (state.step !== 'WAIT_MSG1B') {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }
    if (msg1B.length < 1) {
      throw new BadRequestException('missing party B first message');
    }

    const session = SignSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const allMsg1 = decodeWireMessages(Message as any, [
        state.msg1C,
        ...msg1B,
      ]);
      const msg2CLive = session.handleMessages(
        filterMessages(allMsg1, MPC_PARTY_C) as any,
      );
      state.msg2C = encodeWireMessages(msg2CLive as any);
      state.stateB64 = bytesToBase64(session.toBytes());
      state.step = 'WAIT_MSG2B';
      this.sessions.set(sessionId, state);
      return { sessionId, messages: state.msg2C };
    } finally {
      session.free();
    }
  }

  /** Main sends msg2B → return msg3C. */
  round2(sessionId: string, msg2B: WireMessage[]) {
    const state = this.require(sessionId);
    if (state.step !== 'WAIT_MSG2B' || !state.msg2C) {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }

    const session = SignSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const allMsg2 = decodeWireMessages(Message as any, [
        ...msg2B,
        ...state.msg2C,
      ]);
      const msg3CLive = session.handleMessages(
        selectMessages(allMsg2, MPC_PARTY_C) as any,
      );
      state.msg3C = encodeWireMessages(msg3CLive as any);
      state.stateB64 = bytesToBase64(session.toBytes());
      state.step = 'WAIT_MSG3B';
      this.sessions.set(sessionId, state);
      return { sessionId, messages: state.msg3C };
    } finally {
      session.free();
    }
  }

  /** Main sends msg3B → consume select(msg3). */
  round3(sessionId: string, msg3B: WireMessage[]) {
    const state = this.require(sessionId);
    if (state.step !== 'WAIT_MSG3B' || !state.msg3C) {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }

    const session = SignSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const allMsg3 = decodeWireMessages(Message as any, [
        ...msg3B,
        ...state.msg3C,
      ]);
      session.handleMessages(selectMessages(allMsg3, MPC_PARTY_C) as any);
      state.stateB64 = bytesToBase64(session.toBytes());
      state.step = 'WAIT_LAST';
      this.sessions.set(sessionId, state);
      return { sessionId, ok: true as const };
    } finally {
      session.free();
    }
  }

  /** Produce party C lastMessage(digest). Share C never leaves. */
  lastMessage(sessionId: string) {
    const state = this.require(sessionId);
    if (state.step !== 'WAIT_LAST') {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }

    const session = SignSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const digest = base64ToBytes(state.digestB64);
      const msg4CLive = session.lastMessage(digest);
      const msg4C = encodeWireMessages([msg4CLive as any]);
      state.step = 'DONE';
      this.sessions.delete(sessionId);
      return { sessionId, messages: msg4C };
    } finally {
      session.free();
    }
  }

  abort(sessionId: string) {
    this.sessions.delete(sessionId);
    return { ok: true as const };
  }

  private require(sessionId: string): SignSessionState {
    this.gc();
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new NotFoundException('Sign session not found');
    }
    return state;
  }

  private gc() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}
