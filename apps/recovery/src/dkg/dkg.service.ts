import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { encryptShareC } from '../crypto/share-c-encryption';
import { PrismaService } from '../prisma/prisma.service';
import { KeygenSession, Message } from '../mpc/wasm';
import {
  MPC_PARTIES,
  MPC_PARTY_C,
  MPC_THRESHOLD,
  base64ToBytes,
  bytesToBase64,
  decodeWireMessages,
  encodeWireMessages,
  filterMessages,
  publicKeyToHex,
  selectMessages,
  type WireMessage,
} from '../mpc/wire';

type DkgSessionState = {
  sessionId: string;
  userId: string;
  walletId: string;
  stateB64: string;
  commitmentB64?: string;
  createdAt: number;
};

const SESSION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class DkgService {
  private readonly sessions = new Map<string, DkgSessionState>();

  constructor(private readonly prisma: PrismaService) {}

  start(params: { sessionId: string; userId: string; walletId: string }) {
    this.gc();
    if (this.sessions.has(params.sessionId)) {
      throw new BadRequestException('DKG session already exists');
    }

    const session = new KeygenSession(
      MPC_PARTIES,
      MPC_THRESHOLD,
      MPC_PARTY_C,
    );
    const msg1 = session.createFirstMessage();
    const wire = encodeWireMessages([msg1 as any])[0];

    this.sessions.set(params.sessionId, {
      sessionId: params.sessionId,
      userId: params.userId,
      walletId: params.walletId,
      stateB64: bytesToBase64(session.toBytes()),
      createdAt: Date.now(),
    });

    session.free();
    return { message: wire };
  }

  handleRound1(
    sessionId: string,
    allRound1: WireMessage[],
  ): { messages: WireMessage[]; commitmentB64: string } {
    const state = this.require(sessionId);
    const session = KeygenSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const incoming = decodeWireMessages(Message as any, allRound1);
      const outgoing = session.handleMessages(
        filterMessages(incoming, MPC_PARTY_C) as any,
      );
      const commitment = session.calculateChainCodeCommitment();
      const commitmentB64 = bytesToBase64(commitment);
      const messages = encodeWireMessages(outgoing as any);

      state.stateB64 = bytesToBase64(session.toBytes());
      state.commitmentB64 = commitmentB64;
      this.sessions.set(sessionId, state);

      return { messages, commitmentB64 };
    } finally {
      session.free();
    }
  }

  handleP2P(
    sessionId: string,
    incomingWire: WireMessage[],
    commitmentsB64?: string[],
  ): { messages: WireMessage[] } {
    const state = this.require(sessionId);
    const session = KeygenSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const incoming = decodeWireMessages(Message as any, incomingWire);
      const selected = selectMessages(incoming, MPC_PARTY_C);
      const commitments = commitmentsB64?.map((c) => base64ToBytes(c));
      const outgoing = session.handleMessages(selected as any, commitments as any);
      const messages = encodeWireMessages(outgoing as any);

      state.stateB64 = bytesToBase64(session.toBytes());
      this.sessions.set(sessionId, state);

      return { messages };
    } finally {
      session.free();
    }
  }

  handleBroadcast(sessionId: string, incomingWire: WireMessage[]): { ok: true } {
    const state = this.require(sessionId);
    const session = KeygenSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const incoming = decodeWireMessages(Message as any, incomingWire);
      session.handleMessages(filterMessages(incoming, MPC_PARTY_C) as any);
      state.stateB64 = bytesToBase64(session.toBytes());
      this.sessions.set(sessionId, state);
      return { ok: true };
    } finally {
      session.free();
    }
  }

  async finalize(sessionId: string) {
    const state = this.require(sessionId);
    const session = KeygenSession.fromBytes(base64ToBytes(state.stateB64));
    let share;
    try {
      share = session.keyshare();
    } catch (error) {
      session.free();
      throw error;
    }

    try {
      const publicKeyHex = publicKeyToHex(share.publicKey);
      const shareBytes = Buffer.from(share.toBytes());
      const encryptedShareC = encryptShareC(shareBytes);

      const existing = await this.prisma.mpcRecoveryShare.findUnique({
        where: { walletId: state.walletId },
      });
      if (existing?.status === 'ACTIVE') {
        throw new BadRequestException('Active Share C already exists');
      }

      if (existing) {
        await this.prisma.mpcRecoveryShare.update({
          where: { walletId: state.walletId },
          data: {
            userId: state.userId,
            partyId: MPC_PARTY_C,
            mpcPublicKey: publicKeyHex,
            encryptedShareC,
            status: 'ACTIVE',
            retiredAt: null,
          },
        });
      } else {
        await this.prisma.mpcRecoveryShare.create({
          data: {
            walletId: state.walletId,
            userId: state.userId,
            partyId: MPC_PARTY_C,
            mpcPublicKey: publicKeyHex,
            encryptedShareC,
            status: 'ACTIVE',
          },
        });
      }

      this.sessions.delete(sessionId);

      return {
        walletId: state.walletId,
        partyId: MPC_PARTY_C,
        mpcPublicKey: publicKeyHex,
      };
    } finally {
      share.free();
    }
  }

  abort(sessionId: string) {
    this.sessions.delete(sessionId);
    return { ok: true };
  }

  private require(sessionId: string): DkgSessionState {
    this.gc();
    const state = this.sessions.get(sessionId);
    if (!state) throw new NotFoundException('DKG session not found');
    return state;
  }

  private gc() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) this.sessions.delete(id);
    }
  }
}
