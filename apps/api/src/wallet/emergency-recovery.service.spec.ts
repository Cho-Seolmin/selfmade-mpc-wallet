import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from '../auth/totp.service';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { RpcProviderService } from './rpc-provider.service';

describe('EmergencyRecoveryService', () => {
  let service: EmergencyRecoveryService;
  let prisma: {
    wallet: { findUnique: jest.Mock; update: jest.Mock };
    withdrawRequest: { findMany: jest.Mock; update: jest.Mock };
    withdrawalAuditLog: { create: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let totp: { verify: jest.Mock };
  let getTransactionReceipt: jest.Mock;

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
      withdrawRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      withdrawalAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'w1' }]),
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => unknown) =>
        fn(prisma),
      ),
    };
    totp = {
      verify: jest.fn(),
    };
    getTransactionReceipt = jest.fn().mockResolvedValue(null);
    const rpc = {
      getProvider: jest.fn().mockReturnValue({ getTransactionReceipt }),
    };
    service = new EmergencyRecoveryService(
      prisma as unknown as PrismaService,
      new AuditService(prisma as unknown as PrismaService),
      totp as unknown as TotpService,
      rpc as unknown as RpcProviderService,
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
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('rejects emergency start while A+B PROCESSING is open', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    totp.verify.mockResolvedValue(true);
    prisma.withdrawRequest.findMany.mockResolvedValue([
      {
        id: 'wr1',
        status: 'PROCESSING',
        txHash: null,
        metadata: { mode: 'NORMAL_AB', sessionId: 's1' },
      },
    ]);

    await expect(
      service.startEmergencyRecovery('u1', 'w1', '123456'),
    ).rejects.toMatchObject({
      response: { code: MpcErrorCode.SIGN_SESSION_BUSY },
    });
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('rejects emergency start while A+B BROADCASTED has no receipt', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    totp.verify.mockResolvedValue(true);
    prisma.withdrawRequest.findMany.mockResolvedValue([
      {
        id: 'wr1',
        status: 'BROADCASTED',
        txHash: '0xabctx',
        metadata: { mode: 'NORMAL_AB' },
      },
    ]);
    getTransactionReceipt.mockResolvedValue(null);

    await expect(
      service.startEmergencyRecovery('u1', 'w1', '123456'),
    ).rejects.toMatchObject({
      response: { code: MpcErrorCode.TRANSACTION_PENDING },
    });
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('settles successful BROADCASTED receipt then starts emergency', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    totp.verify.mockResolvedValue(true);
    prisma.withdrawRequest.findMany.mockResolvedValue([
      {
        id: 'wr1',
        status: 'BROADCASTED',
        txHash: '0xabctx',
        metadata: { mode: 'NORMAL_AB' },
      },
    ]);
    getTransactionReceipt.mockResolvedValue({ status: 1 });
    prisma.wallet.update.mockResolvedValue({
      ...baseWallet,
      status: WalletStatus.RECOVERY_PENDING,
    });

    const result = await service.startEmergencyRecovery('u1', 'w1', '123456');
    expect(prisma.withdrawRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wr1' },
        data: expect.objectContaining({ status: 'EXECUTED' }),
      }),
    );
    expect(result.wallet.status).toBe(WalletStatus.RECOVERY_PENDING);
  });

  it('settles reverted BROADCASTED receipt then starts emergency', async () => {
    prisma.wallet.findUnique.mockResolvedValue(baseWallet);
    totp.verify.mockResolvedValue(true);
    prisma.withdrawRequest.findMany.mockResolvedValue([
      {
        id: 'wr1',
        status: 'BROADCASTED',
        txHash: '0xabctx',
        metadata: { mode: 'NORMAL_AB' },
      },
    ]);
    getTransactionReceipt.mockResolvedValue({ status: 0 });
    prisma.wallet.update.mockResolvedValue({
      ...baseWallet,
      status: WalletStatus.RECOVERY_PENDING,
    });

    const result = await service.startEmergencyRecovery('u1', 'w1', '123456');
    expect(prisma.withdrawRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wr1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
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
