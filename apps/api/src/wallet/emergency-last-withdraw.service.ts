import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WalletStatus } from '@prisma/client';
import { getAddress, type Transaction } from 'ethers';
import { AuditEventType } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { decryptShareB } from '../common/crypto/share-b-encryption';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';
import { signDigestBcRelay } from '../mpc/bc-sign-relay';
import {
  isInsufficientGasError,
  prepareErc20FullBalanceTransfer,
  prepareFullBalanceTransfer,
  serializeSignedTransfer,
  signedRawTxHash,
  txFieldsForStorage,
  unsignedTxDigest32,
} from '../mpc/eth-transfer';
import { RecoveryClientService } from '../mpc/recovery-client.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import {
  findLatestEmergencyBc,
  settleOpenEmergencyBcOrThrow,
  transactionPendingException,
  type EmergencyBcAsset,
  type EmergencyBcMetadata,
} from './emergency-bc-withdraw';
import { getConfiguredTestTokenAddress } from './erc20-balance';
import { RpcProviderService } from './rpc-provider.service';
import { assertWalletNotRetired } from './wallet-lifecycle';
import {
  receiptLookup,
  settleOpenNormalAbOrThrow,
} from './normal-ab-withdraw';

@Injectable()
export class EmergencyLastWithdrawService {
  private readonly logger = new Logger(EmergencyLastWithdrawService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: RpcProviderService,
    private readonly recovery: RecoveryClientService,
    private readonly emergencyOtp: EmergencyRecoveryService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Emergency last withdraw: B+C threshold sign (wire relay) → broadcast → RETIRED.
   * Each asset step persists BROADCASTED + txHash + signed raw before RPC.
   * TTK remaining with insufficient ETH gas aborts without RETIRED.
   * Share C never leaves Recovery. Share A unused. Never logs share material.
   */
  async executeLastWithdraw(
    userId: string,
    walletId: string,
    toAddressRaw: string,
    otp: string,
  ) {
    let toAddress: string;
    try {
      toAddress = getAddress(toAddressRaw);
    } catch {
      throw new BadRequestException({
        message: '수신 주소 형식이 올바르지 않습니다.',
        code: MpcErrorCode.INVALID_ADDRESS,
      });
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        id: true,
        userId: true,
        walletType: true,
        status: true,
        address: true,
        mpcPublicKey: true,
        encryptedShareB: true,
        createdAt: true,
        retiredAt: true,
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
    assertWalletNotRetired(wallet.status, '비상 전액 출금');
    if (
      wallet.status !== WalletStatus.RECOVERY_PENDING &&
      wallet.status !== WalletStatus.RETIRING
    ) {
      throw new BadRequestException({
        message:
          '비상 출금은 OTP 인증(RECOVERY_PENDING) 이후에만 가능합니다.',
        code: MpcErrorCode.EMERGENCY_STATE_INVALID,
      });
    }
    if (!wallet.encryptedShareB) {
      throw new BadRequestException({
        message: 'Share B가 없어 비상 출금을 진행할 수 없습니다.',
        code: MpcErrorCode.SHARE_B_MISSING,
      });
    }
    if (getAddress(wallet.address) === toAddress) {
      throw new BadRequestException({
        message: '수신 주소가 출금 지갑과 같을 수 없습니다.',
        code: MpcErrorCode.INVALID_ADDRESS,
      });
    }

    await this.emergencyOtp.verifyEmergencyOtp(userId, wallet.id, otp);

    const tokenAddress = getConfiguredTestTokenAddress();
    const existingToken = tokenAddress
      ? await findLatestEmergencyBc(this.prisma, wallet.id, 'ERC20')
      : null;
    const tokenNeedsNewSweep =
      !!tokenAddress &&
      existingToken?.status !== 'BROADCASTED' &&
      existingToken?.status !== 'EXECUTED';
    if (tokenNeedsNewSweep) {
      await this.assertTokenSweepHasGas(wallet.address, toAddress);
    }

    const pendingRebroadcast = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE
      `;
      const locked = await tx.wallet.findUnique({
        where: { id: wallet.id },
        select: { status: true, encryptedShareB: true },
      });
      if (!locked) {
        throw new NotFoundException({
          message: 'Wallet not found',
          code: MpcErrorCode.WALLET_NOT_FOUND,
        });
      }
      assertWalletNotRetired(locked.status, '비상 전액 출금');
      if (
        locked.status !== WalletStatus.RECOVERY_PENDING &&
        locked.status !== WalletStatus.RETIRING
      ) {
        throw new BadRequestException({
          message:
            '비상 출금은 OTP 인증(RECOVERY_PENDING) 이후에만 가능합니다.',
          code: MpcErrorCode.EMERGENCY_STATE_INVALID,
        });
      }
      if (!locked.encryptedShareB) {
        throw new BadRequestException({
          message: 'Share B가 없어 비상 출금을 진행할 수 없습니다.',
          code: MpcErrorCode.SHARE_B_MISSING,
        });
      }
      await settleOpenNormalAbOrThrow({
        db: tx,
        walletId: wallet.id,
        getReceipt: receiptLookup(this.rpc.getProvider()),
      });
      const emergencySettle = await settleOpenEmergencyBcOrThrow({
        db: tx,
        walletId: wallet.id,
        getReceipt: receiptLookup(this.rpc.getProvider()),
      });
      if (locked.status !== WalletStatus.RETIRING) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { status: WalletStatus.RETIRING },
        });
      }
      return emergencySettle;
    });

    if (pendingRebroadcast.action === 'rebroadcast') {
      await this.rebroadcastSameRaw(pendingRebroadcast.signedRaw);
      throw transactionPendingException();
    }

    await this.audit.write({
      walletId: wallet.id,
      userId,
      eventType: AuditEventType.EMERGENCY_WITHDRAW_REQUESTED,
      message: 'Emergency B+C last withdraw started (share-C stays on Recovery)',
      data: { toAddress, mode: 'BC_WIRE_RELAY' },
    });

    let shareBBytes: Buffer | null = null;

    try {
      shareBBytes = decryptShareB(wallet.encryptedShareB);
      const provider = this.rpc.getProvider();

      let tokenTxHash: string | null = null;
      let tokenAmount = 0n;
      if (tokenAddress) {
        const tokenRow = await findLatestEmergencyBc(
          this.prisma,
          wallet.id,
          'ERC20',
        );
        if (tokenRow?.status === 'EXECUTED') {
          tokenTxHash = tokenRow.txHash;
          try {
            tokenAmount = BigInt(tokenRow.amount);
          } catch {
            tokenAmount = 0n;
          }
        } else {
          try {
            const preparedToken = await prepareErc20FullBalanceTransfer({
              provider,
              fromAddress: wallet.address,
              toAddress,
              tokenAddress,
            });
            tokenAmount = preparedToken.tokenAmount;
            const tokenResult = await this.signPersistBroadcastWait({
              shareBBytes,
              walletId: wallet.id,
              expectedAddress: wallet.address,
              toAddress,
              tx: preparedToken.tx,
              amount: tokenAmount.toString(),
              asset: 'ERC20',
              metadataExtra: {
                tokenAddress,
                tokenAmount: tokenAmount.toString(),
                feeWei: preparedToken.feeWei.toString(),
                balanceWei: preparedToken.balanceWei.toString(),
              },
            });
            tokenTxHash = tokenResult.txHash;
            if (tokenResult.status === 'BROADCASTED') {
              throw transactionPendingException();
            }
          } catch (err: unknown) {
            if (err instanceof Error && err.message === 'ZERO_TOKEN_BALANCE') {
              this.logger.warn(
                `Emergency last withdraw: zero token balance for wallet ${wallet.id}`,
              );
            } else {
              this.rethrowMappedLastWithdrawError(err);
            }
          }
        }
      }

      let txHash: string | null = null;
      let valueWei = 0n;
      let ethRow = await findLatestEmergencyBc(this.prisma, wallet.id, 'ETH');

      if (ethRow?.status === 'EXECUTED') {
        txHash = ethRow.txHash;
        try {
          valueWei = BigInt(ethRow.amount);
        } catch {
          valueWei = 0n;
        }
      } else {
        try {
          const prepared = await prepareFullBalanceTransfer({
            provider,
            fromAddress: wallet.address,
            toAddress,
          });
          valueWei = prepared.valueWei;
          const ethResult = await this.signPersistBroadcastWait({
            shareBBytes,
            walletId: wallet.id,
            expectedAddress: wallet.address,
            toAddress,
            tx: prepared.tx,
            amount: valueWei.toString(),
            asset: 'ETH',
            metadataExtra: {
              feeWei: prepared.feeWei.toString(),
              balanceWei: prepared.balanceWei.toString(),
              tokenTxHash,
            },
          });
          txHash = ethResult.txHash;
          ethRow = {
            id: ethResult.id,
            status: ethResult.status,
            txHash,
            amount: valueWei.toString(),
            toAddress,
            createdAt: new Date(),
            metadata: null,
          };
          if (ethResult.status === 'BROADCASTED') {
            throw transactionPendingException();
          }
        } catch (err: any) {
          if (err?.message === 'ZERO_BALANCE') {
            this.logger.warn(
              `Emergency last withdraw: zero ETH for wallet ${wallet.id}, retiring without ETH broadcast`,
            );
            ethRow = await this.createSkippedEthRow({
              walletId: wallet.id,
              toAddress,
              tokenTxHash,
              skipped: 'ZERO_BALANCE',
            });
          } else if (
            tokenTxHash &&
            typeof err?.message === 'string' &&
            err.message.includes('가스비보다 작아')
          ) {
            this.logger.warn(
              `Emergency last withdraw: ETH dust left after token sweep for wallet ${wallet.id}`,
            );
            ethRow = await this.createSkippedEthRow({
              walletId: wallet.id,
              toAddress,
              tokenTxHash,
              skipped: 'ETH_DUST',
            });
          } else {
            this.rethrowMappedLastWithdrawError(err);
          }
        }
      }

      const now = new Date();
      const withdraw = ethRow ?? {
        id: '',
        amount: valueWei.toString(),
        toAddress,
        status: 'EXECUTED',
        txHash,
      };

      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          status: WalletStatus.RETIRED,
          retiredAt: now,
          encryptedShareB: null,
        },
      });

      try {
        await this.recovery.retireShareC(wallet.id);
      } catch {
        this.logger.error(
          `Failed to retire Share C for wallet ${wallet.id} after last withdraw`,
        );
      }

      await this.audit.write({
        withdrawRequestId: withdraw.id || undefined,
        walletId: wallet.id,
        userId,
        eventType: AuditEventType.EMERGENCY_WITHDRAW_COMPLETED,
        actorType: 'SYSTEM',
        message: 'Emergency B+C last withdraw completed; wallet RETIRED',
        data: {
          txHash,
          tokenTxHash,
          amountWei: valueWei.toString(),
          toAddress,
        },
      });

      await this.audit.write({
        withdrawRequestId: withdraw.id || undefined,
        walletId: wallet.id,
        userId,
        eventType: AuditEventType.WALLET_RETIRED,
        actorType: 'SYSTEM',
        message: 'MPC wallet retired after emergency last withdraw',
      });

      return {
        wallet: {
          id: wallet.id,
          walletType: 'MPC' as const,
          status: WalletStatus.RETIRED,
          address: wallet.address,
          mpcPublicKey: wallet.mpcPublicKey,
          createdAt: wallet.createdAt,
          retiredAt: now,
          resolvedAddress: wallet.address,
          addressSource: 'WALLET_ROW' as const,
        },
        withdraw: {
          id: withdraw.id,
          amount: withdraw.amount,
          toAddress: withdraw.toAddress,
          status: withdraw.status,
          txHash: withdraw.txHash,
        },
        tokenWithdraw: tokenTxHash
          ? {
              amount: tokenAmount.toString(),
              toAddress,
              status: 'EXECUTED' as const,
              txHash: tokenTxHash,
            }
          : null,
        message: this.lastWithdrawMessage(txHash, tokenTxHash),
      };
    } catch (err: any) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      if (isInsufficientGasError(err)) {
        throw this.insufficientGasException();
      }
      const message = err?.message || 'Emergency last withdraw failed';
      await this.audit.write({
        walletId: wallet.id,
        userId,
        eventType: AuditEventType.EMERGENCY_WITHDRAW_FAILED,
        actorType: 'SYSTEM',
        message: 'Emergency B+C last withdraw failed',
        data: { error: String(message).slice(0, 300) },
      });

      throw new BadRequestException({
        message: `비상 전액 출금에 실패했습니다: ${String(message).slice(0, 200)}`,
        code: MpcErrorCode.EMERGENCY_WITHDRAW_FAILED,
      });
    } finally {
      if (shareBBytes) shareBBytes.fill(0);
    }
  }

  private insufficientGasException(): BadRequestException {
    return new BadRequestException({
      message:
        'TTK 잔액이 있지만 가스비로 쓸 Sepolia ETH가 부족합니다. MPC 지갑 주소로 소량의 ETH를 입금한 뒤 비상 출금을 다시 시도하세요. 지갑은 폐기되지 않았습니다.',
      code: MpcErrorCode.INSUFFICIENT_GAS,
    });
  }

  private rethrowMappedLastWithdrawError(err: unknown): never {
    if (
      err instanceof BadRequestException ||
      err instanceof ForbiddenException ||
      err instanceof NotFoundException ||
      err instanceof ConflictException
    ) {
      throw err;
    }
    if (isInsufficientGasError(err)) {
      throw this.insufficientGasException();
    }
    throw err;
  }

  private async assertTokenSweepHasGas(
    fromAddress: string,
    toAddress: string,
  ): Promise<void> {
    const tokenAddress = getConfiguredTestTokenAddress();
    if (!tokenAddress) return;
    try {
      await prepareErc20FullBalanceTransfer({
        provider: this.rpc.getProvider(),
        fromAddress,
        toAddress,
        tokenAddress,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ZERO_TOKEN_BALANCE') {
        return;
      }
      this.rethrowMappedLastWithdrawError(err);
    }
  }

  private lastWithdrawMessage(
    ethTxHash: string | null,
    tokenTxHash: string | null,
  ): string {
    if (ethTxHash && tokenTxHash) {
      return 'TTK와 ETH 전액 출금이 완료되었고 지갑이 RETIRED 처리되었습니다. 새 MPC 지갑을 생성할 수 있습니다.';
    }
    if (tokenTxHash) {
      return '토큰 전액 출금 후 지갑을 폐기(RETIRED)했습니다. 새 MPC 지갑을 생성할 수 있습니다.';
    }
    if (ethTxHash) {
      return 'B+C 전액 출금이 완료되었고 지갑이 RETIRED 처리되었습니다. 새 MPC 지갑을 생성할 수 있습니다.';
    }
    return '잔액이 없어 온체인 전송 없이 지갑을 폐기(RETIRED)했습니다. 새 MPC 지갑을 생성할 수 있습니다.';
  }

  private async createSkippedEthRow(params: {
    walletId: string;
    toAddress: string;
    tokenTxHash: string | null;
    skipped: string;
  }) {
    const now = new Date();
    return this.prisma.withdrawRequest.create({
      data: {
        walletId: params.walletId,
        amount: '0',
        toAddress: params.toAddress,
        status: 'EXECUTED',
        executionType: 'MPC',
        finalizedAt: now,
        metadata: {
          mode: 'EMERGENCY_BC_RELAY',
          asset: 'ETH',
          zeroBalance: true,
          skipped: params.skipped,
          tokenTxHash: params.tokenTxHash,
        } satisfies EmergencyBcMetadata as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async rebroadcastSameRaw(signedRaw: string): Promise<void> {
    try {
      await this.rpc.getProvider().broadcastTransaction(signedRaw);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Emergency rebroadcast of stored raw failed: ${message.slice(0, 200)}`,
      );
    }
  }

  /**
   * PROCESSING row → sign → persist BROADCASTED+txHash+signedRaw → RPC → wait.
   * wait failure leaves BROADCASTED (no re-sign). Same-request sign failure
   * marks PROCESSING as FAILED because persist-before-RPC has not happened.
   */
  private async signPersistBroadcastWait(params: {
    shareBBytes: Buffer;
    walletId: string;
    expectedAddress: string;
    toAddress: string;
    tx: Transaction;
    amount: string;
    asset: EmergencyBcAsset;
    metadataExtra: Record<string, unknown>;
  }): Promise<{
    id: string;
    txHash: string;
    status: 'BROADCASTED' | 'EXECUTED';
  }> {
    const storedTx = txFieldsForStorage(params.tx);
    const processingMeta: EmergencyBcMetadata = {
      mode: 'EMERGENCY_BC_RELAY',
      asset: params.asset,
      tx: storedTx,
      ...params.metadataExtra,
    };

    const processing = await this.prisma.$transaction(async (db) => {
      await db.$queryRaw`
        SELECT id FROM "Wallet" WHERE id = ${params.walletId} FOR UPDATE
      `;
      const open = await settleOpenEmergencyBcOrThrow({
        db,
        walletId: params.walletId,
        getReceipt: receiptLookup(this.rpc.getProvider()),
      });
      if (open.action === 'rebroadcast') {
        throw transactionPendingException();
      }
      const existing = await findLatestEmergencyBc(
        db,
        params.walletId,
        params.asset,
      );
      if (existing?.status === 'EXECUTED') {
        return { kind: 'executed' as const, row: existing };
      }
      if (
        existing?.status === 'BROADCASTED' ||
        existing?.status === 'PROCESSING'
      ) {
        throw transactionPendingException();
      }
      const row = await db.withdrawRequest.create({
        data: {
          walletId: params.walletId,
          amount: params.amount,
          toAddress: params.toAddress,
          status: 'PROCESSING',
          executionType: 'MPC',
          processingAt: new Date(),
          nonce: storedTx.nonce,
          metadata: processingMeta as unknown as Prisma.InputJsonValue,
        },
      });
      return { kind: 'created' as const, row };
    });

    if (processing.kind === 'executed') {
      return {
        id: processing.row.id,
        txHash: processing.row.txHash || '',
        status: 'EXECUTED',
      };
    }

    const withdrawId = processing.row.id;
    try {
      const digest = unsignedTxDigest32(params.tx);
      const signature = await signDigestBcRelay({
        shareBBytes: new Uint8Array(params.shareBBytes),
        digest32: digest,
        walletId: params.walletId,
        expectedAddress: params.expectedAddress,
        recovery: this.recovery,
      });
      const raw = serializeSignedTransfer(params.tx, signature);
      const txHash = signedRawTxHash(raw);
      const broadcastedAt = new Date();

      await this.prisma.withdrawRequest.update({
        where: { id: withdrawId },
        data: {
          status: 'BROADCASTED',
          txHash,
          broadcastedAt,
          metadata: {
            ...processingMeta,
            signedRaw: raw,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const response = await this.rpc
        .getProvider()
        .broadcastTransaction(raw);

      try {
        await response.wait(1);
        const confirmedAt = new Date();
        await this.prisma.withdrawRequest.update({
          where: { id: withdrawId },
          data: {
            status: 'EXECUTED',
            confirmedAt,
            finalizedAt: confirmedAt,
          },
        });
        return { id: withdrawId, txHash, status: 'EXECUTED' };
      } catch {
        this.logger.warn(
          `Emergency ${params.asset} wait failed; leaving BROADCASTED txHash=${txHash}`,
        );
        throw transactionPendingException();
      }
    } catch (err) {
      if (err instanceof ConflictException) {
        throw err;
      }
      const again = await this.prisma.withdrawRequest.findUnique({
        where: { id: withdrawId },
        select: { status: true },
      });
      if (again?.status === 'PROCESSING') {
        await this.prisma.withdrawRequest
          .update({
            where: { id: withdrawId },
            data: {
              status: 'FAILED',
              failureReason: String(
                err instanceof Error ? err.message : err,
              ).slice(0, 300),
            },
          })
          .catch(() => undefined);
      }
      throw err;
    }
  }
}
