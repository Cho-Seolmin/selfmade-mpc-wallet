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
import { getAddress, hexlify } from 'ethers';
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
  parseWithdrawAsset,
  prepareAmountTransfer,
  prepareErc20AmountTransfer,
  isInsufficientGasError,
  serializeSignedTransfer,
  txFromStoredFields,
  unsignedTxDigest32,
  type WithdrawAsset,
} from './eth-transfer';
import { Keyshare, Message, SignSession } from './wasm';
import { RpcProviderService } from '../wallet/rpc-provider.service';
import { assertWalletNotRetired } from '../wallet/wallet-lifecycle';
import {
  receiptLookup,
  settleOpenNormalAbOrThrow,
} from '../wallet/normal-ab-withdraw';
import { getConfiguredTestTokenAddress } from '../wallet/erc20-balance';

function createId(): string {
  return `s${randomBytes(16).toString('hex')}`;
}

type UnsignedTxFields = {
  to: string;
  value: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  chainId: string;
  data: string;
};

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
  tx: UnsignedTxFields;
  address: string;
  step:
    | 'WAIT_MSG1A'
    | 'WAIT_MSG2A'
    | 'WAIT_MSG3A'
    | 'WAIT_MSG4A'
    | 'COMPLETING'
    | 'DONE';
  createdAt: number;
};

type AbWithdrawMetadata = {
  mode: 'NORMAL_AB';
  sessionId: string;
  feeWei: string;
  digestB64: string;
  msg1B: MpcWireMessage;
  fromAddress: string;
  asset?: WithdrawAsset;
};

type TerminalAbStatus = 'BROADCASTED' | 'EXECUTED';

type AbWithdrawView = {
  id: string;
  amount: string;
  toAddress: string;
  status: TerminalAbStatus;
  txHash: string | null;
};

type CompleteResult = {
  withdraw: AbWithdrawView;
  message: string;
};

type SigningStartResult = {
  alreadyBroadcast?: false;
  sessionId: string;
  walletId: string;
  digestB64: string;
  msg1B: MpcWireMessage;
  amountWei: string;
  feeWei: string;
  toAddress: string;
  fromAddress: string;
  /** Unsigned EIP-1559 fields for browser WYSIWYS digest recompute. */
  tx: UnsignedTxFields;
  reused?: boolean;
};

/** Same Idempotency-Key after broadcast: no session resume / re-sign / rebroadcast. */
type TerminalStartResult = {
  alreadyBroadcast: true;
  sessionId: string;
  walletId: string;
  amountWei: string;
  toAddress: string;
  withdraw: AbWithdrawView;
  message: string;
};

type StartResult = SigningStartResult | TerminalStartResult;

function isTerminalAbStatus(status: string): status is TerminalAbStatus {
  return status === 'BROADCASTED' || status === 'EXECUTED';
}

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
   * BROADCASTED/EXECUTED with the same key returns the existing txHash (no session resume).
   * At most one in-flight NORMAL_AB (PROCESSING or unsettled BROADCASTED) per wallet.
   */
  async start(
    userId: string,
    walletId: string,
    toAddressRaw: string,
    amount: string,
    idempotencyKeyRaw?: string,
    assetRaw?: string,
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

    let asset: WithdrawAsset;
    try {
      asset = parseWithdrawAsset(assetRaw);
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Invalid asset');
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
        asset,
      );
    }

    let prepared;
    try {
      if (asset === 'ERC20') {
        const tokenAddress = getConfiguredTestTokenAddress();
        if (!tokenAddress) {
          throw new Error(
            'SEPOLIA_TEST_TOKEN_ADDRESS가 설정되지 않았습니다.',
          );
        }
        prepared = await prepareErc20AmountTransfer({
          provider: this.rpc.getProvider(),
          fromAddress: wallet.address,
          toAddress,
          amountRaw: amountWei,
          tokenAddress,
        });
      } else {
        prepared = await prepareAmountTransfer({
          provider: this.rpc.getProvider(),
          fromAddress: wallet.address,
          toAddress,
          amountWei,
        });
      }
    } catch (err: any) {
      if (isInsufficientGasError(err)) {
        throw new BadRequestException({
          message:
            '토큰 출금 가스로 쓸 Sepolia ETH가 부족합니다. MPC 지갑 주소로 소량의 ETH를 입금한 뒤 다시 시도하세요.',
          code: MpcErrorCode.INSUFFICIENT_GAS,
        });
      }
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
        asset,
      };

      const withdraw = await this.prisma.$transaction(async (tx) => {
        // Serialize start per wallet (single-instance portfolio; also helps races).
        await tx.$queryRaw`
          SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE
        `;

        const lockedWallet = await tx.wallet.findUnique({
          where: { id: wallet.id },
          select: { status: true },
        });
        if (lockedWallet?.status !== WalletStatus.ACTIVE) {
          throw new BadRequestException({
            message:
              '일반 출금은 ACTIVE 지갑에서만 가능합니다. 비상 복구 상태면 B+C 전액 출금을 사용하세요.',
            code: MpcErrorCode.EMERGENCY_STATE_INVALID,
          });
        }

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

        await settleOpenNormalAbOrThrow({
          db: tx,
          walletId: wallet.id,
          getReceipt: receiptLookup(this.rpc.getProvider()),
        });

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
          asset,
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
          to: getAddress(prepared.tx.to!),
          value: prepared.tx.value!.toString(),
          nonce: prepared.tx.nonce!,
          gasLimit: prepared.tx.gasLimit!.toString(),
          maxFeePerGas: prepared.tx.maxFeePerGas!.toString(),
          maxPriorityFeePerGas: prepared.tx.maxPriorityFeePerGas!.toString(),
          chainId: prepared.tx.chainId!.toString(),
          data: hexlify(prepared.tx.data ?? '0x'),
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
          asset,
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
        tx: state.tx,
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
   * Persist BROADCASTED + txHash immediately after broadcast (before receipt).
   * Retry of complete for BROADCASTED/EXECUTED returns the existing txHash
   * without re-signing, rebroadcast, or waiting for a receipt.
   */
  async complete(
    userId: string,
    sessionId: string,
    msg4A: MpcWireMessage[],
  ): Promise<CompleteResult> {
    this.gc();

    const existingTerminal = await this.findTerminalBySession(
      userId,
      sessionId,
    );
    if (existingTerminal) {
      return existingTerminal;
    }

    const state = this.sessions.get(sessionId);
    if (!state || state.userId !== userId) {
      throw new NotFoundException('Sign session not found');
    }

    const wr = await this.prisma.withdrawRequest.findUnique({
      where: { id: state.withdrawRequestId },
    });
    if (wr && isTerminalAbStatus(wr.status)) {
      this.sessions.delete(sessionId);
      return this.toCompleteResult(wr, true);
    }

    if (state.step !== 'WAIT_MSG4A') {
      const raced = await this.findTerminalBySession(userId, sessionId);
      if (raced) return raced;
      throw new BadRequestException(`unexpected step ${state.step}`);
    }
    if (msg4A.length < 1) {
      throw new BadRequestException('missing party A last message');
    }

    const walletNow = await this.prisma.wallet.findUnique({
      where: { id: state.walletId },
      select: { status: true },
    });
    if (walletNow?.status !== WalletStatus.ACTIVE) {
      this.sessions.delete(sessionId);
      await this.prisma.withdrawRequest
        .updateMany({
          where: { id: state.withdrawRequestId, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            failureReason: 'wallet left ACTIVE before A+B broadcast',
          },
        })
        .catch(() => undefined);
      throw new BadRequestException({
        message:
          '일반 출금은 ACTIVE 지갑에서만 가능합니다. 비상 복구가 시작된 뒤에는 A+B를 완료할 수 없습니다.',
        code: MpcErrorCode.EMERGENCY_STATE_INVALID,
      });
    }

    state.step = 'COMPLETING';
    this.sessions.set(sessionId, state);

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

      const broadcastedAt = new Date();
      const broadcasted = await this.prisma.withdrawRequest.update({
        where: { id: state.withdrawRequestId },
        data: {
          status: 'BROADCASTED',
          txHash: response.hash,
          broadcastedAt,
        },
      });
      this.sessions.delete(sessionId);

      try {
        await response.wait(1);
        const confirmedAt = new Date();
        const executed = await this.prisma.withdrawRequest.update({
          where: { id: state.withdrawRequestId },
          data: {
            status: 'EXECUTED',
            confirmedAt,
            finalizedAt: confirmedAt,
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

        return this.toCompleteResult(executed, false);
      } catch {
        this.logger.warn(
          `sign complete wait failed session=${sessionId}; leaving BROADCASTED txHash=${response.hash}`,
        );
        await this.audit.write({
          walletId: state.walletId,
          userId,
          withdrawRequestId: state.withdrawRequestId,
          eventType: AuditEventType.WITHDRAW_COMPLETED,
          actorType: 'SYSTEM',
          message: 'Normal A+B withdraw broadcasted (receipt wait skipped)',
          data: {
            txHash: response.hash,
            amountWei: state.tx.value,
            toAddress: state.tx.to,
          },
        });
        return this.toCompleteResult(broadcasted, false);
      }
    } catch (err: any) {
      this.sessions.delete(sessionId);
      const again = await this.prisma.withdrawRequest
        .findUnique({ where: { id: state.withdrawRequestId } })
        .catch(() => null);
      if (again && isTerminalAbStatus(again.status)) {
        return this.toCompleteResult(again, true);
      }

      const message = err?.message || 'A+B withdraw failed';
      this.logger.error(`sign complete failed session=${sessionId}`);
      if (!again || again.status === 'PROCESSING') {
        await this.prisma.withdrawRequest
          .update({
            where: { id: state.withdrawRequestId },
            data: {
              status: 'FAILED',
              failureReason: String(message).slice(0, 300),
            },
          })
          .catch(() => undefined);
      }
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
        .updateMany({
          where: { id: state.withdrawRequestId, status: 'PROCESSING' },
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
      txHash: string | null;
      metadata: unknown;
    },
    toAddress: string,
    amountWeiStr: string,
    asset: WithdrawAsset = 'ETH',
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

    const rowAsset: WithdrawAsset = meta.asset === 'ERC20' ? 'ERC20' : 'ETH';
    if (
      getAddress(row.toAddress) !== getAddress(toAddress) ||
      row.amount !== amountWeiStr ||
      rowAsset !== asset
    ) {
      throw new ConflictException({
        message:
          '같은 Idempotency-Key로 다른 수신 주소/금액/자산이 요청되었습니다.',
        code: MpcErrorCode.IDEMPOTENCY_CONFLICT,
      });
    }

    if (isTerminalAbStatus(row.status)) {
      this.sessions.delete(meta.sessionId);
      return {
        alreadyBroadcast: true,
        sessionId: meta.sessionId,
        walletId,
        amountWei: amountWeiStr,
        toAddress,
        withdraw: {
          id: row.id,
          amount: row.amount,
          toAddress: row.toAddress,
          status: row.status,
          txHash: row.txHash,
        },
        message:
          row.status === 'EXECUTED'
            ? '출금이 이미 완료되었습니다.'
            : '출금이 이미 브로드캐스트되었습니다.',
      };
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
      tx: live.tx,
      reused: true,
    };
  }

  private toCompleteResult(
    row: {
      id: string;
      amount: string;
      toAddress: string;
      status: string;
      txHash: string | null;
    },
    retried: boolean,
  ): CompleteResult {
    const status: TerminalAbStatus = isTerminalAbStatus(row.status)
      ? row.status
      : 'BROADCASTED';
    const already =
      status === 'EXECUTED'
        ? '출금이 이미 완료되었습니다.'
        : '출금이 이미 브로드캐스트되었습니다.';
    const first =
      status === 'EXECUTED'
        ? '출금이 완료되었습니다.'
        : '출금이 브로드캐스트되었습니다.';
    return {
      withdraw: {
        id: row.id,
        amount: row.amount,
        toAddress: row.toAddress,
        status,
        txHash: row.txHash,
      },
      message: retried ? already : first,
    };
  }

  private async findTerminalBySession(userId: string, sessionId: string) {
    const match = await this.prisma.withdrawRequest.findFirst({
      where: {
        wallet: { userId },
        status: { in: ['BROADCASTED', 'EXECUTED'] },
        metadata: {
          path: ['sessionId'],
          equals: sessionId,
        },
      },
    });
    if (!match || !isTerminalAbStatus(match.status)) return null;
    return this.toCompleteResult(match, true);
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
          .updateMany({
            where: { id: s.withdrawRequestId, status: 'PROCESSING' },
            data: { status: 'EXPIRED', failureReason: 'sign session expired' },
          })
          .catch(() => undefined);
      }
    }
  }
}
