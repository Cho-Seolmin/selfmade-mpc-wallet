import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from '../auth/totp.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EmergencyRecoveryService', () => {
  let service: EmergencyRecoveryService;
  let prisma: {
    wallet: { findUnique: jest.Mock; update: jest.Mock };
    withdrawalAuditLog: { create: jest.Mock };
  };
  let totp: { verify: jest.Mock };

  const baseWallet = {
    id: 'w1',
    userId: 'u1',
    walletType: 'MPC',
    status: WalletStatus.ACTIVE,
    address: '0x1111111111111111111111111111111111111111',
    mpcPublicKey: '0x03aa',
    encryptedShareB: 'cipher',
    createdAt: new Date('2026-01-01'),
    retiredAt: null,
  };

  beforeEach(() => {
    prisma = {
      wallet: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      withdrawalAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    totp = {
      verify: jest.fn(),
    };
    service = new EmergencyRecoveryService(
      prisma as unknown as PrismaService,
      new AuditService(prisma as unknown as PrismaService),
      totp as unknown as TotpService,
    );
    service.resetOtpFailuresForTests();
  });

  it('rejects invalid OTP format', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    await expect(
      service.startEmergencyRecovery('u1', 'w1', '12345'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects RETIRED wallet', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      ...baseWallet,
      status: WalletStatus.RETIRED,
    });
    totp.verify.mockResolvedValue(true);
    await expect(
      service.startEmergencyRecovery('u1', 'w1', '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records failure and throws on wrong OTP', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    totp.verify.mockResolvedValue(false);
    await expect(
      service.startEmergencyRecovery('u1', 'w1', '123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.withdrawalAuditLog.create).toHaveBeenCalled();
  });

  it('sets RECOVERY_PENDING on successful OTP', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    totp.verify.mockResolvedValue(true);
    prisma.wallet.update.mockResolvedValue({
      ...baseWallet,
      status: WalletStatus.RECOVERY_PENDING,
    });

    const result = await service.startEmergencyRecovery('u1', 'w1', '123456');
    expect(result.wallet.status).toBe(WalletStatus.RECOVERY_PENDING);
    expect(prisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: WalletStatus.RECOVERY_PENDING },
      }),
    );
  });

  it('is idempotent when already RECOVERY_PENDING', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      ...baseWallet,
      status: WalletStatus.RECOVERY_PENDING,
    });
    totp.verify.mockResolvedValue(true);

    const result = await service.startEmergencyRecovery('u1', 'w1', '123456');
    expect(result.wallet.status).toBe(WalletStatus.RECOVERY_PENDING);
  });

  it('cancels RECOVERY_PENDING back to ACTIVE', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      ...baseWallet,
      status: WalletStatus.RECOVERY_PENDING,
    });
    prisma.wallet.update.mockResolvedValue({
      ...baseWallet,
      status: WalletStatus.ACTIVE,
    });

    const result = await service.cancelEmergencyRecovery('u1', 'w1');
    expect(result.wallet.status).toBe(WalletStatus.ACTIVE);
    expect(prisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: WalletStatus.ACTIVE },
      }),
    );
  });

  it('rejects cancel while RETIRING', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      ...baseWallet,
      status: WalletStatus.RETIRING,
    });
    await expect(
      service.cancelEmergencyRecovery('u1', 'w1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
