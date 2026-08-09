import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  MPC_PARTIES,
  MPC_PARTY,
  MPC_THRESHOLD,
  base64ToBytes,
  bytesToBase64,
  decodeWireMessages,
  encodeWireMessages,
  ethAddressFromPublicKey,
  filterMessages,
  publicKeyToHex,
  selectMessages,
  type MpcWireMessage,
} from '@selfmade/mpc-crypto';
import { WalletStatus } from '@prisma/client';
import { AuditEventType } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { encryptShareB } from '../common/crypto/share-b-encryption';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { LIVE_WALLET_STATUSES } from '../wallet/wallet-lifecycle';
import { KeygenSession, Message } from './wasm';
import { RecoveryClientService } from './recovery-client.service';

function createId(): string {
  return `c${randomBytes(16).toString('hex')}`;
}

type DkgSession = {
  sessionId: string;
  userId: string;
  walletId: string;
  /** Party B KeygenSession bytes */
  stateB64: string;
  msg1A: MpcWireMessage;
  msg1B: MpcWireMessage;
  msg1C: MpcWireMessage;
  msg2B?: MpcWireMessage[];
  msg2C?: MpcWireMessage[];
  commitmentA?: string;
  commitmentB?: string;
  commitmentC?: string;
  msg3B?: MpcWireMessage[];
  msg3C?: MpcWireMessage[];
  msg4B?: MpcWireMessage[];
  msg4C?: MpcWireMessage[];
  step:
    | 'WAIT_ROUND1_DONE'
    | 'WAIT_ROUND2'
    | 'WAIT_ROUND3'
    | 'WAIT_ROUND4'
    | 'WAIT_FINAL'
    | 'DONE';
  createdAt: number;
};

const SESSION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class DkgOrchestratorService {
  private readonly sessions = new Map<string, DkgSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly recovery: RecoveryClientService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Browser (party A) sends its round-1 broadcast.
   * Main (B) + Recovery (C) start and process round 1.
   * Returns peer round-1 messages so A can continue.
   */
  async start(userId: string, msg1A: MpcWireMessage) {
    this.gc();
    await this.assertNoLiveWallet(userId);

    if (msg1A.from !== MPC_PARTY.A) {
      throw new BadRequestException('first message must be from party A (0)');
    }

    const sessionId = createId();
    const walletId = createId();

    const sessionB = new KeygenSession(
      MPC_PARTIES,
      MPC_THRESHOLD,
      MPC_PARTY.B,
    );
    const msg1BLive = sessionB.createFirstMessage();
    const msg1B = encodeWireMessages([msg1BLive])[0];

    const { message: msg1C } = await this.recovery.startDkg({
      sessionId,
      userId,
      walletId,
    });

    const allMsg1 = [msg1A, msg1B, msg1C];

    const incomingB = decodeWireMessages(Message, allMsg1);
    const msg2BLive = sessionB.handleMessages(
      filterMessages(incomingB, MPC_PARTY.B),
    );
    const commitmentB = bytesToBase64(sessionB.calculateChainCodeCommitment());
    const msg2B = encodeWireMessages(msg2BLive);

    const round1C = await this.recovery.dkgRound1(sessionId, allMsg1);

    const state: DkgSession = {
      sessionId,
      userId,
      walletId,
      stateB64: bytesToBase64(sessionB.toBytes()),
      msg1A,
      msg1B,
      msg1C,
      msg2B,
      msg2C: round1C.messages,
      commitmentB,
      commitmentC: round1C.commitmentB64,
      step: 'WAIT_ROUND2',
      createdAt: Date.now(),
    };
    sessionB.free();
    this.sessions.set(sessionId, state);

    return {
      sessionId,
      walletId,
      partyId: MPC_PARTY.A,
      peerRound1Messages: [msg1B, msg1C],
    };
  }

  /**
   * Browser finished round1 locally and sends P2P msg2A + commitmentA.
   * Returns P2P messages addressed to A from round2 pool.
   */
  async round2(
    userId: string,
    sessionId: string,
    msg2A: MpcWireMessage[],
    commitmentA: string,
  ) {
    const state = this.requireOwned(userId, sessionId);
    if (state.step !== 'WAIT_ROUND2') {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }

    state.commitmentA = commitmentA;
    const allMsg2 = [...msg2A, ...(state.msg2B ?? []), ...(state.msg2C ?? [])];

    const sessionB = KeygenSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const incoming = decodeWireMessages(Message, allMsg2);
      const msg3BLive = sessionB.handleMessages(
        selectMessages(incoming, MPC_PARTY.B),
      );
      state.msg3B = encodeWireMessages(msg3BLive);
      state.stateB64 = bytesToBase64(sessionB.toBytes());
    } finally {
      sessionB.free();
    }

    const round3C = await this.recovery.dkgP2P(sessionId, allMsg2);
    state.msg3C = round3C.messages;
    state.step = 'WAIT_ROUND3';
    this.sessions.set(sessionId, state);

    const forA = allMsg2.filter((m) => m.to === MPC_PARTY.A);
    return {
      sessionId,
      messagesForA: forA,
    };
  }

  /**
   * Browser sends msg3A. Server runs round3→4 for B/C with commitments.
   * Returns messages for A (from msg3) + full commitment list.
   */
  async round3(userId: string, sessionId: string, msg3A: MpcWireMessage[]) {
    const state = this.requireOwned(userId, sessionId);
    if (state.step !== 'WAIT_ROUND3') {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }
    if (!state.commitmentA || !state.commitmentB || !state.commitmentC) {
      throw new BadRequestException('missing commitments');
    }

    const commitments = [
      state.commitmentA,
      state.commitmentB,
      state.commitmentC,
    ];
    const allMsg3 = [...msg3A, ...(state.msg3B ?? []), ...(state.msg3C ?? [])];

    const sessionB = KeygenSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const incoming = decodeWireMessages(Message, allMsg3);
      const selected = selectMessages(incoming, MPC_PARTY.B);
      const commitmentBytes = commitments.map((c) => base64ToBytes(c));
      const msg4BLive = sessionB.handleMessages(
        selected,
        commitmentBytes as any,
      );
      state.msg4B = encodeWireMessages(msg4BLive);
      state.stateB64 = bytesToBase64(sessionB.toBytes());
    } finally {
      sessionB.free();
    }

    const round4C = await this.recovery.dkgP2P(
      sessionId,
      allMsg3,
      commitments,
    );
    state.msg4C = round4C.messages;
    state.step = 'WAIT_ROUND4';
    this.sessions.set(sessionId, state);

    return {
      sessionId,
      messagesForA: allMsg3.filter((m) => m.to === MPC_PARTY.A),
      commitmentsB64: commitments,
    };
  }

  /**
   * Browser sends msg4A (last broadcast). Server finalizes B+C broadcast round.
   * Returns peer broadcast messages for A to finish, then client calls complete.
   */
  async round4(userId: string, sessionId: string, msg4A: MpcWireMessage[]) {
    const state = this.requireOwned(userId, sessionId);
    if (state.step !== 'WAIT_ROUND4') {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }

    const allMsg4 = [...msg4A, ...(state.msg4B ?? []), ...(state.msg4C ?? [])];

    const sessionB = KeygenSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const incoming = decodeWireMessages(Message, allMsg4);
      sessionB.handleMessages(filterMessages(incoming, MPC_PARTY.B));
      state.stateB64 = bytesToBase64(sessionB.toBytes());
    } finally {
      sessionB.free();
    }

    await this.recovery.dkgBroadcast(sessionId, allMsg4);
    state.step = 'WAIT_FINAL';
    this.sessions.set(sessionId, state);

    return {
      sessionId,
      messagesForA: allMsg4.filter((m) => m.from !== MPC_PARTY.A),
    };
  }

  /**
   * Finalize: extract Share B, store encrypted; Recovery stores Share C;
   * create ACTIVE wallet. Returns wallet DTO + does NOT return Share B.
   * Browser already has Share A locally.
   */
  async complete(userId: string, sessionId: string) {
    const state = this.requireOwned(userId, sessionId);
    if (state.step !== 'WAIT_FINAL') {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }

    await this.assertNoLiveWallet(userId);

    const sessionB = KeygenSession.fromBytes(base64ToBytes(state.stateB64));
    let shareB;
    try {
      shareB = sessionB.keyshare();
    } catch (error) {
      sessionB.free();
      throw error;
    }

    try {
      const publicKeyHex = publicKeyToHex(shareB.publicKey);
      const address = ethAddressFromPublicKey(shareB.publicKey);
      const encryptedShareB = encryptShareB(Buffer.from(shareB.toBytes()));

      const recoveryResult = await this.recovery.dkgFinalize(sessionId);
      if (
        recoveryResult.mpcPublicKey.toLowerCase() !== publicKeyHex.toLowerCase()
      ) {
        await this.recovery.dkgAbort(sessionId);
        throw new BadRequestException('Share B/C public key mismatch');
      }

      const wallet = await this.prisma.wallet.create({
        data: {
          id: state.walletId,
          userId,
          walletType: 'MPC',
          status: WalletStatus.ACTIVE,
          address,
          mpcPublicKey: publicKeyHex,
          encryptedShareB,
        },
        select: {
          id: true,
          walletType: true,
          status: true,
          address: true,
          mpcPublicKey: true,
          createdAt: true,
          retiredAt: true,
        },
      });

      await this.audit.write({
        walletId: wallet.id,
        userId,
        eventType: AuditEventType.MPC_WALLET_CREATED,
        message: '2-of-3 MPC wallet created via DKG',
        data: {
          address: wallet.address,
          sessionId: state.sessionId,
        },
      });

      state.step = 'DONE';
      this.sessions.delete(sessionId);

      return {
        wallet: {
          ...wallet,
          resolvedAddress: wallet.address,
          addressSource: 'WALLET_ROW' as const,
        },
        /** Browser must persist Share A locally (STEP 5 encrypts at rest). */
        partyId: MPC_PARTY.A,
      };
    } finally {
      shareB.free();
    }
  }

  async abort(userId: string, sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (state && state.userId === userId) {
      this.sessions.delete(sessionId);
      await this.recovery.dkgAbort(sessionId);
    }
    return { ok: true };
  }

  private async assertNoLiveWallet(userId: string) {
    const existing = await this.prisma.wallet.findFirst({
      where: {
        userId,
        walletType: 'MPC',
        status: { in: LIVE_WALLET_STATUSES },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        message: 'Live MPC wallet already exists',
        code: MpcErrorCode.LIVE_WALLET_EXISTS,
      });
    }
  }

  private requireOwned(userId: string, sessionId: string): DkgSession {
    this.gc();
    const state = this.sessions.get(sessionId);
    if (!state) throw new NotFoundException('DKG session not found');
    if (state.userId !== userId) {
      throw new NotFoundException('DKG session not found');
    }
    return state;
  }

  private gc() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        void this.recovery.dkgAbort(id);
      }
    }
  }
}
