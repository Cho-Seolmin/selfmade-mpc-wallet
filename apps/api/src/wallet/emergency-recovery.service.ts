import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { AuditEventType } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { TotpService } from '../auth/totp.service';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { OtpFailureTracker } from './otp-failure-tracker';
import { assertWalletNotRetired } from './wallet-lifecycle';

@Injectable()
export class EmergencyRecoveryService {
  /** Shared across requests in this process (portfolio-simple). */
  private readonly otpFailures = new OtpFailureTracker();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly totp: TotpService,
  ) {}

  /**
   * Verify Google OTP for emergency flows (start + last withdraw).
   * Never logs the OTP value. Shares one failure/lockout tracker.
   */
  async verifyEmergencyOtp(
    userId: string,
    walletId: string,
    otp: string,
  ): Promise<void> {
    if (!/^\d{6}$/.test(otp)) {
      throw new BadRequestException({
        message: 'OTP must be a 6-digit code',
        code: MpcErrorCode.OTP_FORMAT,
      });
    }

    try {
      this.otpFailures.assertNotLocked(userId);
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (msg.startsWith('OTP_LOCKED:')) {
        const seconds = msg.slice('OTP_LOCKED:'.length);
        throw new UnauthorizedException({
          message: `OTP 인증이 잠겼습니다. ${seconds}초 후 다시 시도하세요.`,
          code: MpcErrorCode.OTP_LOCKED,
        });
      }
      throw err;
    }

    const ok = await this.totp.verify(userId, otp);
    if (!ok) {
      const result = this.otpFailures.recordFailure(userId);
      await this.audit.write({
        walletId,
        userId,
        eventType: AuditEventType.EMERGENCY_OTP_FAILED,
        message: 'Emergency recovery OTP verification failed',
        data: {
          remainingAttempts: result.remainingAttempts,
          locked: result.locked,
        },
      });

      if (result.locked) {
        throw new UnauthorizedException({
          message: `OTP 인증 실패가 누적되어 잠겼습니다. ${result.lockSeconds}초 후 다시 시도하세요.`,
          code: MpcErrorCode.OTP_LOCKED,
        });
      }
      throw new UnauthorizedException({
        message: `OTP가 올바르지 않습니다. 남은 시도: ${result.remainingAttempts}회`,
        code: MpcErrorCode.OTP_INVALID,
      });
    }

    this.otpFailures.clear(userId);
  }

  /**
   * Google OTP gate for emergency last-withdraw path.
   * On success: ACTIVE → RECOVERY_PENDING (B+C withdraw is STEP 8).
   * Never logs or returns OTP material.
   */
  async startEmergencyRecovery(
    userId: string,
    walletId: string,
    otp: string,
  ) {
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
    assertWalletNotRetired(wallet.status, '비상 복구');
    if (wallet.status === WalletStatus.RETIRING) {
      throw new BadRequestException({
        message:
          '비상 출금이 이미 진행 중입니다. 완료될 때까지 기다려 주세요.',
        code: MpcErrorCode.EMERGENCY_STATE_INVALID,
      });
    }
    if (!wallet.encryptedShareB) {
      throw new BadRequestException({
        message: 'Share B가 없어 비상 복구를 진행할 수 없습니다.',
        code: MpcErrorCode.SHARE_B_MISSING,
      });
    }

    await this.verifyEmergencyOtp(userId, wallet.id, otp);

    const updated =
      wallet.status === WalletStatus.RECOVERY_PENDING
        ? wallet
        : await this.prisma.wallet.update({
            where: { id: wallet.id },
            data: { status: WalletStatus.RECOVERY_PENDING },
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
      eventType: AuditEventType.EMERGENCY_RECOVERY_STARTED,
      message:
        'Emergency recovery OTP verified; wallet set to RECOVERY_PENDING',
      data: {
        previousStatus: wallet.status,
        nextStep: 'B+C last withdraw',
      },
    });

    return {
      wallet: {
        id: updated.id,
        walletType: updated.walletType,
        status: updated.status,
        address: updated.address,
        mpcPublicKey: updated.mpcPublicKey,
        createdAt: updated.createdAt,
        retiredAt: updated.retiredAt,
        resolvedAddress: updated.address,
        addressSource: 'WALLET_ROW' as const,
      },
      message:
        'OTP 인증에 성공했습니다. 지갑이 RECOVERY_PENDING 상태입니다. 다음 단계에서 B+C 전액 출금(마지막 출금)을 진행합니다.',
    };
  }

  /**
   * Undo accidental emergency/start: RECOVERY_PENDING → ACTIVE.
   * Not allowed once RETIRING (last withdraw in progress).
   */
  async cancelEmergencyRecovery(userId: string, walletId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        id: true,
        userId: true,
        walletType: true,
        status: true,
        address: true,
        mpcPublicKey: true,
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
    assertWalletNotRetired(wallet.status, '비상 복구 취소');

    if (wallet.status === WalletStatus.ACTIVE) {
      return {
        wallet: {
          id: wallet.id,
          walletType: wallet.walletType,
          status: wallet.status,
          address: wallet.address,
          mpcPublicKey: wallet.mpcPublicKey,
          createdAt: wallet.createdAt,
          retiredAt: wallet.retiredAt,
          resolvedAddress: wallet.address,
          addressSource: 'WALLET_ROW' as const,
        },
        message: '이미 ACTIVE 상태입니다.',
      };
    }

    if (wallet.status === WalletStatus.RETIRING) {
      throw new BadRequestException({
        message:
          '비상 출금이 진행 중(RETIRING)이라 취소할 수 없습니다. 전액 출금을 완료하거나 재시도하세요.',
        code: MpcErrorCode.EMERGENCY_STATE_INVALID,
      });
    }

    if (wallet.status !== WalletStatus.RECOVERY_PENDING) {
      throw new BadRequestException({
        message: '비상 복구 취소는 RECOVERY_PENDING 상태에서만 가능합니다.',
        code: MpcErrorCode.EMERGENCY_STATE_INVALID,
      });
    }

    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { status: WalletStatus.ACTIVE },
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
      eventType: AuditEventType.EMERGENCY_RECOVERY_CANCELLED,
      message: 'Emergency recovery cancelled; wallet returned to ACTIVE',
      data: {
        previousStatus: WalletStatus.RECOVERY_PENDING,
        nextStatus: WalletStatus.ACTIVE,
      },
    });

    return {
      wallet: {
        id: updated.id,
        walletType: updated.walletType,
        status: updated.status,
        address: updated.address,
        mpcPublicKey: updated.mpcPublicKey,
        createdAt: updated.createdAt,
        retiredAt: updated.retiredAt,
        resolvedAddress: updated.address,
        addressSource: 'WALLET_ROW' as const,
      },
      message:
        '비상 복구를 취소했습니다. 지갑이 다시 ACTIVE입니다. 일반 출금(A+B)을 사용할 수 있습니다.',
    };
  }

  /** Exposed for unit tests. */
  resetOtpFailuresForTests(): void {
    this.otpFailures.resetAll();
  }
}
