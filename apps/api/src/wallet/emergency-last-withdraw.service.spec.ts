import { BadRequestException } from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { Transaction } from 'ethers';
import { EmergencyLastWithdrawService } from './emergency-last-withdraw.service';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecoveryClientService } from '../mpc/recovery-client.service';
import { SignerService } from './signer.service';

jest.mock('../common/crypto/share-b-encryption', () => ({
  decryptShareB: jest.fn(() => Buffer.from('share-b-bytes')),
}));

jest.mock('../mpc/bc-sign-relay', () => ({
  signDigestBcRelay: jest.fn(async () => ({
    r: new Uint8Array(32),
    s: new Uint8Array(32),
    v: 27,
  })),
}));

jest.mock('../mpc/eth-transfer', () => ({
  prepareFullBalanceTransfer: jest.fn(async () => ({
    tx: Transaction.from({
      type: 2,
      to: '0x2222222222222222222222222222222222222222',
      value: 1n,
      nonce: 0,
      gasLimit: 21000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      chainId: 11155111,
    }),
    balanceWei: 100n,
    feeWei: 21n,
    valueWei: 79n,
  })),
  serializeSignedTransfer: jest.fn(() => '0xraw'),
  unsignedTxDigest32: jest.fn(() => new Uint8Array(32)),
}));

import { signDigestBcRelay } from '../mpc/bc-sign-relay';

describe('EmergencyLastWithdrawService', () => {
  let service: EmergencyLastWithdrawService;
  let prisma: any;
  let recovery: { retireShareC: jest.Mock };
  let emergencyOtp: { verifyEmergencyOtp: jest.Mock };
  let signer: { getProvider: jest.Mock };

  const wallet = {
    id: 'w1',
    userId: 'u1',
    walletType: 'MPC',
    status: WalletStatus.RECOVERY_PENDING,
    address: '0x1111111111111111111111111111111111111111',
    mpcPublicKey: '0x03aa',
    encryptedShareB: 'iv:tag:data',
    createdAt: new Date('2026-01-01'),
    retiredAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
        update: jest.fn().mockResolvedValue({}),
      },
      withdrawRequest: {
        create: jest.fn().mockResolvedValue({
          id: 'wr1',
          amount: '79',
          toAddress: '0x2222222222222222222222222222222222222222',
          status: 'EXECUTED',
          txHash: '0xabc',
        }),
      },
      withdrawalAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    recovery = {
      retireShareC: jest.fn().mockResolvedValue({ status: 'RETIRED' }),
    };
    emergencyOtp = {
      verifyEmergencyOtp: jest.fn().mockResolvedValue(undefined),
    };
    signer = {
      getProvider: jest.fn().mockReturnValue({
        broadcastTransaction: jest.fn().mockResolvedValue({
          hash: '0xabc',
          wait: jest.fn().mockResolvedValue({}),
        }),
      }),
    };

    service = new EmergencyLastWithdrawService(
      prisma as unknown as PrismaService,
      signer as unknown as SignerService,
      recovery as unknown as RecoveryClientService,
      emergencyOtp as unknown as EmergencyRecoveryService,
      new AuditService(prisma as unknown as PrismaService),
    );
  });

  it('rejects ACTIVE wallet without RECOVERY_PENDING', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      ...wallet,
      status: WalletStatus.ACTIVE,
    });

    await expect(
      service.executeLastWithdraw(
        'u1',
        'w1',
        '0x2222222222222222222222222222222222222222',
        '123456',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('executes B+C relay last withdraw and retires wallet', async () => {
    const result = await service.executeLastWithdraw(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '123456',
    );

    expect(emergencyOtp.verifyEmergencyOtp).toHaveBeenCalledWith(
      'u1',
      'w1',
      '123456',
    );
    expect(signDigestBcRelay).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'w1',
        expectedAddress: wallet.address,
        recovery,
      }),
    );
    expect(recovery.retireShareC).toHaveBeenCalledWith('w1');
    expect(prisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WalletStatus.RETIRED,
          encryptedShareB: null,
        }),
      }),
    );
    expect(result.wallet.status).toBe(WalletStatus.RETIRED);
    expect(result.withdraw.txHash).toBe('0xabc');
  });
});
