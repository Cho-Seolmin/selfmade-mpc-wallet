import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { getAddress } from 'ethers';
import { WalletStatus } from '@prisma/client';
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
import { SignerService } from '../wallet/signer.service';
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

const SESSION_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class SignOrchestratorService {
  private readonly logger = new Logger(SignOrchestratorService.name);
  private readonly sessions = new Map<string, SignSessionState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: SignerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Start A+B signing: prepare partial ETH transfer, open SignSession(B), return msg1B.
   * Share A never leaves the browser.
   */
  async start(
    userId: string,
    walletId: string,
    toAddressRaw: string,
    amount: string,
  ) {
    this.gc();

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

    let prepared;
    try {
      prepared = await prepareAmountTransfer({
        provider: this.signer.getProvider(),
        fromAddress: wallet.address,
        toAddress,
        amountWei,
      });
    } catch (err: any) {
      const msg = err?.message || 'Failed to prepare transfer';
      throw new BadRequestException(msg);
    }

    const digest = unsignedTxDigest32(prepared.tx);
    const sessionId = createId();

    const shareBPlain = decryptShareB(wallet.encryptedShareB);
    let sessionB: SignSession | null = null;
    try {
      const keyshareB = Keyshare.fromBytes(new Uint8Array(shareBPlain));
      shareBPlain.fill(0);
      sessionB = new SignSession(keyshareB, MPC_CHAIN_PATH);
      const msg1BLive = sessionB.createFirstMessage();
      const msg1B = encodeWireMessages([msg1BLive])[0]!;

      const withdraw = await this.prisma.withdrawRequest.create({
        data: {
          walletId: wallet.id,
          amount: amountWei.toString(),
          toAddress,
          status: 'PROCESSING',
          executionType: 'MPC',
          metadata: {
            mode: 'NORMAL_AB',
            sessionId,
            feeWei: prepared.feeWei.toString(),
          },
        },
      });

      await this.audit.write({
        walletId: wallet.id,
        userId,
        withdrawRequestId: withdraw.id,
        eventType: AuditEventType.WITHDRAW_REQUESTED,
        message: 'Normal A+B withdraw signing started',
        data: {
          toAddress,
          amountWei: amountWei.toString(),
          sessionId,
        },
      });

      const state: SignSessionState = {
        sessionId,
        userId,
        walletId: wallet.id,
        withdrawRequestId: withdraw.id,
        stateB64: bytesToBase64(sessionB.toBytes()),
        msg1B,
        digestB64: bytesToBase64(digest),
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
      sessionB.free();
      sessionB = null;

      return {
        sessionId,
        walletId: wallet.id,
        digestB64: state.digestB64,
        msg1B,
        amountWei: amountWei.toString(),
        feeWei: prepared.feeWei.toString(),
        toAddress,
        fromAddress: wallet.address,
      };
    } catch (err) {
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

  /** Browser sends msg4A (lastMessage); server lastMessage+combine, broadcast. */
  async complete(userId: string, sessionId: string, msg4A: MpcWireMessage[]) {
    const state = this.requireOwned(userId, sessionId);
    if (state.step !== 'WAIT_MSG4A') {
      throw new BadRequestException(`unexpected step ${state.step}`);
    }
    if (msg4A.length < 1) {
      throw new BadRequestException('missing party A last message');
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
      const response = await this.signer
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
