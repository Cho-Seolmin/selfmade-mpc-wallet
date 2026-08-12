import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { getAddress } from 'ethers';
import { AuditEventType } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { decryptShareB } from '../common/crypto/share-b-encryption';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';
import { signDigestBcRelay } from '../mpc/bc-sign-relay';
import {
  prepareFullBalanceTransfer,
  serializeSignedTransfer,
  unsignedTxDigest32,
} from '../mpc/eth-transfer';
import { RecoveryClientService } from '../mpc/recovery-client.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import { RpcProviderService } from './rpc-provider.service';
import { assertWalletNotRetired } from './wallet-lifecycle';

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

    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { status: WalletStatus.RETIRING },
    });

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
      let txHash: string | null = null;
      let valueWei = 0n;
      let feeWei = 0n;
      let balanceWei = 0n;

      try {
        const prepared = await prepareFullBalanceTransfer({
          provider,
          fromAddress: wallet.address,
          toAddress,
        });
        valueWei = prepared.valueWei;
        feeWei = prepared.feeWei;
        balanceWei = prepared.balanceWei;

        const digest = unsignedTxDigest32(prepared.tx);
        const signature = await signDigestBcRelay({
          shareBBytes: new Uint8Array(shareBBytes),
          digest32: digest,
          walletId: wallet.id,
          expectedAddress: wallet.address,
          recovery: this.recovery,
        });

        const raw = serializeSignedTransfer(prepared.tx, signature);
        const response = await provider.broadcastTransaction(raw);
        txHash = response.hash;
        await response.wait(1);
      } catch (err: any) {
        if (err?.message === 'ZERO_BALANCE') {
          this.logger.warn(
            `Emergency last withdraw: zero balance for wallet ${wallet.id}, retiring without broadcast`,
          );
        } else {
          throw err;
        }
      }

      const now = new Date();
      const withdraw = await this.prisma.withdrawRequest.create({
        data: {
          walletId: wallet.id,
          amount: valueWei.toString(),
          toAddress,
          status: 'EXECUTED',
          executionType: 'MPC',
          txHash,
          broadcastedAt: txHash ? now : undefined,
          confirmedAt: txHash ? now : undefined,
          finalizedAt: now,
          metadata: {
            mode: 'EMERGENCY_BC_RELAY',
            balanceWei: balanceWei.toString(),
            feeWei: feeWei.toString(),
            zeroBalance: txHash === null,
          },
        },
      });

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
        withdrawRequestId: withdraw.id,
        walletId: wallet.id,
        userId,
        eventType: AuditEventType.EMERGENCY_WITHDRAW_COMPLETED,
        actorType: 'SYSTEM',
        message: 'Emergency B+C last withdraw completed; wallet RETIRED',
        data: {
          txHash,
          amountWei: valueWei.toString(),
          toAddress,
        },
      });

      await this.audit.write({
        withdrawRequestId: withdraw.id,
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
        message:
          txHash == null
            ? '잔액이 없어 온체인 전송 없이 지갑을 폐기(RETIRED)했습니다. 새 MPC 지갑을 생성할 수 있습니다.'
            : 'B+C 전액 출금이 완료되었고 지갑이 RETIRED 처리되었습니다. 새 MPC 지갑을 생성할 수 있습니다.',
      };
    } catch (err: any) {
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
}
