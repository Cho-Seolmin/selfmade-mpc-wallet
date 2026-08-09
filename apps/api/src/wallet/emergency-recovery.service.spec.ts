import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('../auth/totp.util', () => ({
  verifyUserTotp: jest.fn(),
}));

import { verifyUserTotp } from '../auth/totp.util';

const mockedVerify = verifyUserTotp as jest.MockedFunction<
  typeof verifyUserTotp
>;

describe('EmergencyRecoveryService', () => {
  let service: EmergencyRecoveryService;
  let prisma: {
    wallet: { findUnique: jest.Mock; update: jest.Mock };
    withdrawalAuditLog: { create: jest.Mock };
  };

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
    service = new EmergencyRecoveryService(
      prisma as unknown as PrismaService,
      new AuditService(prisma as unknown as PrismaService),
    );
    service.resetOtpFailuresForTests();
    mockedVerify.mockReset();
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
    mockedVerify.mockReturnValue(true);
    await expect(
      service.startEmergencyRecovery('u1', 'w1', '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records failure and throws on wrong OTP', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    mockedVerify.mockReturnValue(false);

    await expect(
      service.startEmergencyRecovery('u1', 'w1', '000000'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.withdrawalAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'EMERGENCY_OTP_FAILED',
        }),
      }),
    );
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('locks after repeated OTP failures', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    mockedVerify.mockReturnValue(false);

    for (let i = 0; i < 5; i++) {
      await expect(
        service.startEmergencyRecovery('u1', 'w1', '000000'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    await expect(
      service.startEmergencyRecovery('u1', 'w1', '123456'),
    ).rejects.toThrow(/잠겼습니다/);
  });

  it('sets RECOVERY_PENDING on successful OTP', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    mockedVerify.mockReturnValue(true);
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
    expect(prisma.withdrawalAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'EMERGENCY_RECOVERY_STARTED',
        }),
      }),
    );
  });

  it('is idempotent when already RECOVERY_PENDING', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      ...baseWallet,
      status: WalletStatus.RECOVERY_PENDING,
    });
    mockedVerify.mockReturnValue(true);

    const result = await service.startEmergencyRecovery('u1', 'w1', '123456');

    expect(result.wallet.status).toBe(WalletStatus.RECOVERY_PENDING);
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });
});
