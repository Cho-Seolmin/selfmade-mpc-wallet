import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SignerService } from './signer.service';

describe('WalletService RETIRED guards', () => {
  let service: WalletService;
  let prisma: any;
  let signer: { getProvider: jest.Mock };

  const liveWallet = {
    id: 'w-live',
    userId: 'u1',
    walletType: 'MPC',
    status: WalletStatus.ACTIVE,
    address: '0x1111111111111111111111111111111111111111',
    mpcPublicKey: '0x03aa',
    encryptedShareB: 'cipher',
    retiredAt: null,
  };

  const retiredWallet = {
    ...liveWallet,
    id: 'w-retired',
    status: WalletStatus.RETIRED,
    encryptedShareB: null,
    retiredAt: new Date('2026-08-01'),
  };

  beforeEach(() => {
    prisma = {
      wallet: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      walletLimit: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      withdrawRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    signer = {
      getProvider: jest.fn().mockReturnValue({
        getBalance: jest.fn().mockResolvedValue(5n),
      }),
    };
    service = new WalletService(
      prisma as unknown as PrismaService,
      signer as unknown as SignerService,
      new AuditService(prisma as unknown as PrismaService),
    );
  });

  it('list returns only live wallets', async () => {
    prisma.wallet.findMany.mockResolvedValue([liveWallet]);
    const rows = await service.list('u1');
    expect(prisma.wallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: expect.not.arrayContaining([WalletStatus.RETIRED]) },
        }),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('w-live');
  });

  it('listRetired returns RETIRED metadata without share material', async () => {
    prisma.wallet.findMany.mockResolvedValue([retiredWallet]);
    const rows = await service.listRetired('u1');
    expect(rows[0].status).toBe(WalletStatus.RETIRED);
    expect(rows[0].hasEncryptedShareB).toBe(false);
  });

  it('getBalance rejects RETIRED wallets', async () => {
    prisma.wallet.findUnique.mockResolvedValue(retiredWallet);
    await expect(service.getBalance('u1', 'w-retired')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getLimits rejects RETIRED wallets', async () => {
    prisma.wallet.findUnique.mockResolvedValue(retiredWallet);
    await expect(service.getLimits('u1', 'w-retired')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getWithdrawHistory allows RETIRED for audit read', async () => {
    prisma.wallet.findUnique.mockResolvedValue(retiredWallet);
    prisma.withdrawRequest.findMany.mockResolvedValue([
      { id: 'wr1', amount: '1', toAddress: '0x2', status: 'EXECUTED' },
    ]);
    const rows = await service.getWithdrawHistory('u1', 'w-retired');
    expect(rows).toHaveLength(1);
  });

  it('getBalance rejects foreign wallet', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      ...liveWallet,
      userId: 'other',
    });
    await expect(service.getBalance('u1', 'w-live')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('summary exposes canCreateMpcWallet when no live wallet', async () => {
    prisma.wallet.findMany.mockResolvedValue([]);
    prisma.wallet.count.mockResolvedValue(2);
    prisma.wallet.findFirst.mockResolvedValue({
      id: 'w-retired',
      address: retiredWallet.address,
      retiredAt: retiredWallet.retiredAt,
    });

    const summary = await service.getDashboardSummary('u1');
    expect(summary.walletCount).toBe(0);
    expect(summary.canCreateMpcWallet).toBe(true);
    expect(summary.retiredWalletCount).toBe(2);
    expect(summary.latestRetired?.id).toBe('w-retired');
  });

  it('assertRetiredShareBWiped fails if ciphertext remains', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      status: WalletStatus.RETIRED,
      encryptedShareB: 'still-here',
    });
    await expect(
      service.assertRetiredShareBWiped('w-retired'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('assertRetiredShareBWiped passes when wiped', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      status: WalletStatus.RETIRED,
      encryptedShareB: null,
    });
    await expect(
      service.assertRetiredShareBWiped('w-retired'),
    ).resolves.toBeUndefined();
  });
});
