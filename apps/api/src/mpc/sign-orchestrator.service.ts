import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { getAddress } from 'ethers';
import { Prisma, WalletStatus } from '@prisma/client';
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
  type MpcWireMessage,
} from '@selfmade/mpc-crypto';
import { AuditEventType } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { decryptShareB } from '../common/crypto/share-b-encryption';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseWithdrawAmountToWei,
  prepareAmountTransfer,
  serializeSignedTransfer,
  txFromStoredFields,
  unsignedTxDigest32,
} from './eth-transfer';
import { Keyshare, Message, SignSession } from './wasm';
import { RpcProviderService } from '../wallet/rpc-provider.service';
import { assertWalletNotRetired } from '../wallet/wallet-lifecycle';

function createId(): string {
  return `s${randomBytes(16).toString('hex')}`;
}

type SignSessionState = {
  sessionId: string;
  userId: string;
  walletId: string;
  withdrawRequestId: string;
  stateB64: string;
  msg1B: MpcWireMessage;
  msg2B?: MpcWireMessage[];
  msg3B?: MpcWireMessage[];
  digestB64: string;
  tx: {
    to: string;
    value: string;
    nonce: number;
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    chainId: string;
  };
  address: string;
  step: 'WAIT_MSG1A' | 'WAIT_MSG2A' | 'WAIT_MSG3A' | 'WAIT_MSG4A' | 'DONE';
  createdAt: number;
};

type AbWithdrawMetadata = {
  mode: 'NORMAL_AB';
  sessionId: string;
  feeWei: string;
  digestB64: string;
  msg1B: MpcWireMessage;
  fromAddress: string;
};

type StartResult = {
  sessionId: string;
  walletId: string;
  digestB64: string;
  msg1B: MpcWireMessage;
  amountWei: string;
  feeWei: string;
  toAddress: string;
  fromAddress: string;
  reused?: boolean;
};

const SESSION_TTL_MS = 10 * 60 * 1000;

function scopedIdempotencyKey(walletId: string, rawKey: string): string {
  return `ab:${walletId}:${rawKey.trim()}`;
}

function asAbMetadata(raw: unknown): AbWithdrawMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.mode !== 'NORMAL_AB') return null;
  if (typeof m.sessionId !== 'string') return null;
  if (typeof m.digestB64 !== 'string') return null;
  if (typeof m.feeWei !== 'string') return null;
  if (typeof m.fromAddress !== 'string') return null;
  if (!m.msg1B || typeof m.msg1B !== 'object') return null;
  return m as unknown as AbWithdrawMetadata;
}

@Injectable()
export class SignOrchestratorService {
  private readonly logger = new Logger(SignOrchestratorService.name);
  private readonly sessions = new Map<string, SignSessionState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: RpcProviderService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Start A+B signing: prepare partial ETH transfer, open SignSession(B), return msg1B.
   * Idempotency-Key reuses the same PROCESSING withdraw when body matches.
   * At most one NORMAL_AB PROCESSING withdraw per wallet (DB lock + check).
   */
  async start(
    userId: string,
    walletId: string,
    toAddressRaw: string,
    amount: string,
    idempotencyKeyRaw?: string,
  ): Promise<StartResult> {
    this.gc();

    const rawKey = idempotencyKeyRaw?.trim();
    if (!rawKey) {
      throw new BadRequestException({
        message: 'Idempotency-Key 헤더가 필요합니다.',
        code: MpcErrorCode.VALIDATION_FAILED,
      });
    }

    let toAddress: string;
    try {
      toAddress = getAddress(toAddressRaw);
    } catch {
      throw new BadRequestException({
        message: '수신 주소 형식이 올바르지 않습니다.',
        code: MpcErrorCode.INVALID_ADDRESS,
      });
    }

    let amountWei: bigint;
    try {
      amountWei = parseWithdrawAmountToWei(amount);
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Invalid amount');
    }

    const wallet = await this.requireActiveMpcWallet(userId, walletId);
    if (!wallet.encryptedShareB) {
      throw new BadRequestException({
        message: 'Share B가 없어 출금할 수 없습니다.',
        code: MpcErrorCode.SHARE_B_MISSING,
      });
    }
    if (getAddress(wallet.address) === toAddress) {
      throw new BadRequestException({
        message: '수신 주소가 출금 지갑과 같을 수 없습니다.',
        code: MpcErrorCode.INVALID_ADDRESS,
      });
    }

    const idempotencyKey = scopedIdempotencyKey(wallet.id, rawKey);
    const amountWeiStr = amountWei.toString();

    // Fast path: same Idempotency-Key already exists (outside lock is OK; body check is authoritative).
    const existingByKey = await this.prisma.withdrawRequest.findUnique({
      where: { idempotencyKey },
    });
    if (existingByKey) {
      return this.reuseOrConflictExisting(
        userId,
        wallet.id,
        existingByKey,
        toAddress,
        amountWeiStr,
      );
    }

    let prepared;
    try {
      prepared = await prepareAmountTransfer({
        provider: this.rpc.getProvider(),
        fromAddress: wallet.address,
        toAddress,
        amountWei,
      });
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Failed to prepare transfer');
    }

    const digest = unsignedTxDigest32(prepared.tx);
    const sessionId = createId();
    const digestB64 = bytesToBase64(digest);

    const shareBPlain = decryptShareB(wallet.encryptedShareB);
    let sessionB: SignSession | null = null;

    try {
      const keyshareB = Keyshare.fromBytes(new Uint8Array(shareBPlain));
      shareBPlain.fill(0);
      sessionB = new SignSession(keyshareB, MPC_CHAIN_PATH);
      const msg1B = encodeWireMessages([sessionB.createFirstMessage()])[0]!;
      const stateB64 = bytesToBase64(sessionB.toBytes());
      sessionB.free();
      sessionB = null;

      const metadata: AbWithdrawMetadata = {
        mode: 'NORMAL_AB',
        sessionId,
        feeWei: prepared.feeWei.toString(),
        digestB64,
        msg1B,
        fromAddress: wallet.address,
      };

      const withdraw = await this.prisma.$transaction(async (tx) => {
        // Serialize start per wallet (single-instance portfolio; also helps races).
        await tx.$queryRaw`
          SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE
        `;

        const again = await tx.withdrawRequest.findUnique({
          where: { idempotencyKey },
        });
        if (again) {
          // Concurrent duplicate start with same key — signal reuse outside.
          return { kind: 'reuse' as const, row: again };
        }

        const cutoff = new Date(Date.now() - SESSION_TTL_MS);
        const stale = await tx.withdrawRequest.findMany({
          where: {
            walletId: wallet.id,
            status: 'PROCESSING',
            createdAt: { lt: cutoff },
          },
        });
        for (const row of stale) {
          if (asAbMetadata(row.metadata)) {
            await tx.withdrawRequest.update({
              where: { id: row.id },
              data: {
                status: 'EXPIRED',
                failureReason: 'sign session expired',
              },
            });
            const meta = asAbMetadata(row.metadata);
            if (meta) this.sessions.delete(meta.sessionId);
          }
        }

        const openRows = await tx.withdrawRequest.findMany({
          where: { walletId: wallet.id, status: 'PROCESSING' },
        });
        const busy = openRows.find((r) => asAbMetadata(r.metadata));
        if (busy) {
          throw new ConflictException({
            message:
              '이 지갑에 진행 중인 일반 출금 서명이 있습니다. 완료·취소 후 다시 시도하세요.',
            code: MpcErrorCode.SIGN_SESSION_BUSY,
          });
        }

        try {
          return {
            kind: 'created' as const,
            row: await tx.withdrawRequest.create({
              data: {
                walletId: wallet.id,
                amount: amountWeiStr,
                toAddress,
                status: 'PROCESSING',
                executionType: 'MPC',
                idempotencyKey,
                metadata: metadata as unknown as Prisma.InputJsonValue,
              },
            }),
          };
        } catch (err: any) {
          // Unique idempotencyKey race
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            const raced = await tx.withdrawRequest.findUnique({
              where: { idempotencyKey },
            });
            if (raced) return { kind: 'reuse' as const, row: raced };
          }
          throw err;
        }
      });

      if (withdraw.kind === 'reuse') {
        return this.reuseOrConflictExisting(
          userId,
          wallet.id,
          withdraw.row,
          toAddress,
          amountWeiStr,
        );
      }

      const state: SignSessionState = {
        sessionId,
        userId,
        walletId: wallet.id,
        withdrawRequestId: withdraw.row.id,
        stateB64,
        msg1B,
        digestB64,
        tx: {
          to: toAddress,
          value: prepared.valueWei.toString(),
          nonce: prepared.tx.nonce!,
          gasLimit: prepared.tx.gasLimit!.toString(),
          maxFeePerGas: prepared.tx.maxFeePerGas!.toString(),
          maxPriorityFeePerGas: prepared.tx.maxPriorityFeePerGas!.toString(),
          chainId: prepared.tx.chainId!.toString(),
        },
        address: wallet.address,
        step: 'WAIT_MSG1A',
        createdAt: Date.now(),
      };
      this.sessions.set(sessionId, state);

      await this.audit.write({
        walletId: wallet.id,
        userId,
        withdrawRequestId: withdraw.row.id,
        eventType: AuditEventType.WITHDRAW_REQUESTED,
        message: 'Normal A+B withdraw signing started',
        data: {
          toAddress,
          amountWei: amountWeiStr,
          sessionId,
        },
      });

      return {
        sessionId,
        walletId: wallet.id,
        digestB64,
        msg1B,
        amountWei: amountWeiStr,
        feeWei: prepared.feeWei.toString(),
        toAddress,
        fromAddress: wallet.address,
      };
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof GoneException
      ) {
        throw err;
      }
      this.logger.error(`sign start failed for wallet ${wallet.id}`);
      throw err;
    } finally {
      shareBPlain.fill(0);
      if (sessionB) {
        try {
          sessionB.free();
        } catch {
          // ignore
        }
      }
    }
  }

  /** Browser sends msg1A → server returns msg2B. */
  async round1(userId: string, sessionId: string, msg1A: MpcWireMessage[]) {
    const state = this.requireOwned(userId, sessionId);
    if (state.step !== 'WAIT_MSG1A') {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }
    if (msg1A.length !== 1 || msg1A[0]!.from !== MPC_PARTY.A) {
      throw new BadRequestException('expected a single message from party A');
    }

    const sessionB = SignSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const allMsg1 = decodeWireMessages(Message, [state.msg1B, ...msg1A]);
      const msg2BLive = sessionB.handleMessages(
        filterMessages(allMsg1, MPC_PARTY.B),
      );
      state.msg2B = encodeWireMessages(msg2BLive);
      state.stateB64 = bytesToBase64(sessionB.toBytes());
      state.step = 'WAIT_MSG2A';
      this.sessions.set(sessionId, state);
      return { sessionId, messagesForA: state.msg2B };
    } finally {
      sessionB.free();
    }
  }

  /** Browser sends msg2A → server returns msg3B. */
  async round2(userId: string, sessionId: string, msg2A: MpcWireMessage[]) {
    const state = this.requireOwned(userId, sessionId);
    if (state.step !== 'WAIT_MSG2A' || !state.msg2B) {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }

    const sessionB = SignSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const allMsg2 = decodeWireMessages(Message, [...msg2A, ...state.msg2B]);
      const msg3BLive = sessionB.handleMessages(
        selectMessages(allMsg2, MPC_PARTY.B),
      );
      state.msg3B = encodeWireMessages(msg3BLive);
      state.stateB64 = bytesToBase64(sessionB.toBytes());
      state.step = 'WAIT_MSG3A';
      this.sessions.set(sessionId, state);
      return { sessionId, messagesForA: state.msg3B };
    } finally {
      sessionB.free();
    }
  }

  /** Browser sends msg3A → server consumes select(msg3); ready for lastMessage. */
  async round3(userId: string, sessionId: string, msg3A: MpcWireMessage[]) {
    const state = this.requireOwned(userId, sessionId);
    if (state.step !== 'WAIT_MSG3A' || !state.msg3B) {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }

    const sessionB = SignSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const allMsg3 = decodeWireMessages(Message, [...msg3A, ...state.msg3B]);
      sessionB.handleMessages(selectMessages(allMsg3, MPC_PARTY.B));
      state.stateB64 = bytesToBase64(sessionB.toBytes());
      state.step = 'WAIT_MSG4A';
      this.sessions.set(sessionId, state);
      return { sessionId, ok: true as const };
    } finally {
      sessionB.free();
    }
  }

  /**
   * Browser sends msg4A; combine + broadcast.
   * If withdraw already EXECUTED (client retry after success), return prior result.
   */
  async complete(userId: string, sessionId: string, msg4A: MpcWireMessage[]) {
    this.gc();

    const existingExecuted = await this.findExecutedBySession(userId, sessionId);
    if (existingExecuted) {
      return existingExecuted;
    }

    const state = this.sessions.get(sessionId);
    if (!state || state.userId !== userId) {
      throw new NotFoundException('Sign session not found');
    }
    if (state.step !== 'WAIT_MSG4A') {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }
    if (msg4A.length < 1) {
      throw new BadRequestException('missing party A last message');
    }

    const wr = await this.prisma.withdrawRequest.findUnique({
      where: { id: state.withdrawRequestId },
    });
    if (wr?.status === 'EXECUTED') {
      this.sessions.delete(sessionId);
      return {
        withdraw: {
          id: wr.id,
          amount: wr.amount,
          toAddress: wr.toAddress,
          status: 'EXECUTED' as const,
          txHash: wr.txHash,
        },
        message: '출금이 이미 완료되었습니다.',
      };
    }

    const sessionB = SignSession.fromBytes(base64ToBytes(state.stateB64));
    try {
      const digest = base64ToBytes(state.digestB64);
      const msg4BLive = sessionB.lastMessage(digest);
      const allMsg4 = decodeWireMessages(Message, [
        ...msg4A,
        ...encodeWireMessages([msg4BLive]),
      ]);
      const [r, s] = sessionB.combine(filterMessages(allMsg4, MPC_PARTY.B));
      const signature = buildEcdsaSignature(digest, r, s, state.address);

      const tx = txFromStoredFields(state.tx);
      const raw = serializeSignedTransfer(tx, signature);
      const response = await this.rpc
        .getProvider()
        .broadcastTransaction(raw);
      await response.wait(1);

      const now = new Date();
      await this.prisma.withdrawRequest.update({
        where: { id: state.withdrawRequestId },
        data: {
          status: 'EXECUTED',
          txHash: response.hash,
          broadcastedAt: now,
          confirmedAt: now,
          finalizedAt: now,
        },
      });

      await this.audit.write({
        walletId: state.walletId,
        userId,
        withdrawRequestId: state.withdrawRequestId,
        eventType: AuditEventType.WITHDRAW_COMPLETED,
        actorType: 'SYSTEM',
        message: 'Normal A+B withdraw completed',
        data: {
          txHash: response.hash,
          amountWei: state.tx.value,
          toAddress: state.tx.to,
        },
      });

      state.step = 'DONE';
      this.sessions.delete(sessionId);

      return {
        withdraw: {
          id: state.withdrawRequestId,
          amount: state.tx.value,
          toAddress: state.tx.to,
          status: 'EXECUTED' as const,
          txHash: response.hash,
        },
        message: '출금이 완료되었습니다.',
      };
    } catch (err: any) {
      const message = err?.message || 'A+B withdraw failed';
      this.logger.error(`sign complete failed session=${sessionId}`);
      await this.prisma.withdrawRequest
        .update({
          where: { id: state.withdrawRequestId },
          data: {
            status: 'FAILED',
            failureReason: String(message).slice(0, 300),
          },
        })
        .catch(() => undefined);
      this.sessions.delete(sessionId);
      throw new BadRequestException(
        `출금에 실패했습니다: ${String(message).slice(0, 200)}`,
      );
    } finally {
      try {
        sessionB.free();
      } catch {
        // ignore
      }
    }
  }

  async abort(userId: string, sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (state && state.userId === userId) {
      this.sessions.delete(sessionId);
      await this.prisma.withdrawRequest
        .update({
          where: { id: state.withdrawRequestId },
          data: { status: 'FAILED', failureReason: 'aborted' },
        })
        .catch(() => undefined);
    }
    return { ok: true as const };
  }

  private reuseOrConflictExisting(
    userId: string,
    walletId: string,
    row: {
      id: string;
      walletId: string;
      amount: string;
      toAddress: string;
      status: string;
      metadata: unknown;
    },
    toAddress: string,
    amountWeiStr: string,
  ): StartResult {
    if (row.walletId !== walletId) {
      throw new ConflictException({
        message: 'Idempotency-Key가 다른 지갑 요청에 이미 사용되었습니다.',
        code: MpcErrorCode.IDEMPOTENCY_CONFLICT,
      });
    }

    const meta = asAbMetadata(row.metadata);
    if (!meta) {
      throw new ConflictException({
        message: 'Idempotency-Key가 일반 출금 요청과 일치하지 않습니다.',
        code: MpcErrorCode.IDEMPOTENCY_CONFLICT,
      });
    }

    if (
      getAddress(row.toAddress) !== getAddress(toAddress) ||
      row.amount !== amountWeiStr
    ) {
      throw new ConflictException({
        message:
          '같은 Idempotency-Key로 다른 수신 주소/금액이 요청되었습니다.',
        code: MpcErrorCode.IDEMPOTENCY_CONFLICT,
      });
    }

    const live = this.sessions.get(meta.sessionId);
    if (!live || live.userId !== userId || live.walletId !== walletId) {
      throw new GoneException({
        message:
          '이전 서명 세션이 만료되었습니다. 새 Idempotency-Key로 다시 시작하세요.',
        code: MpcErrorCode.SIGN_SESSION_GONE,
      });
    }

    if (row.status !== 'PROCESSING') {
      throw new ConflictException({
        message: `이 Idempotency-Key 출금은 이미 ${row.status} 상태입니다.`,
        code: MpcErrorCode.IDEMPOTENCY_CONFLICT,
      });
    }

    return {
      sessionId: meta.sessionId,
      walletId,
      digestB64: live.digestB64,
      msg1B: live.msg1B,
      amountWei: amountWeiStr,
      feeWei: meta.feeWei,
      toAddress,
      fromAddress: meta.fromAddress,
      reused: true,
    };
  }

  private async findExecutedBySession(userId: string, sessionId: string) {
    const rows = await this.prisma.withdrawRequest.findMany({
      where: {
        status: 'EXECUTED',
        wallet: { userId },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const match = rows.find((r) => asAbMetadata(r.metadata)?.sessionId === sessionId);
    if (!match) return null;
    return {
      withdraw: {
        id: match.id,
        amount: match.amount,
        toAddress: match.toAddress,
        status: 'EXECUTED' as const,
        txHash: match.txHash,
      },
      message: '출금이 이미 완료되었습니다.',
    };
  }

  private async requireActiveMpcWallet(userId: string, walletId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        id: true,
        userId: true,
        walletType: true,
        status: true,
        address: true,
        encryptedShareB: true,
      },
    });
    if (!wallet || wallet.walletType !== 'MPC') {
      throw new NotFoundException({
        message: 'Wallet not found',
        code: MpcErrorCode.WALLET_NOT_FOUND,
      });
    }
    if (wallet.userId !== userId) {
      throw new ForbiddenException('Not your wallet');
    }
    assertWalletNotRetired(wallet.status, '일반 출금');
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException({
        message:
          '일반 출금은 ACTIVE 지갑에서만 가능합니다. 비상 복구 상태면 B+C 전액 출금을 사용하세요.',
        code: MpcErrorCode.EMERGENCY_STATE_INVALID,
      });
    }
    return wallet;
  }

  private requireOwned(userId: string, sessionId: string): SignSessionState {
    this.gc();
    const state = this.sessions.get(sessionId);
    if (!state || state.userId !== userId) {
      throw new NotFoundException('Sign session not found');
    }
    return state;
  }

  private gc() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        void this.prisma.withdrawRequest
          .update({
            where: { id: s.withdrawRequestId },
            data: { status: 'EXPIRED', failureReason: 'sign session expired' },
          })
          .catch(() => undefined);
      }
    }
  }
}
