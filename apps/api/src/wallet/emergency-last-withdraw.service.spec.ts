import { BadRequestException, ConflictException } from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { Transaction } from 'ethers';
import { EmergencyLastWithdrawService } from './emergency-last-withdraw.service';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import { AuditService } from '../audit/audit.service';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { RecoveryClientService } from '../mpc/recovery-client.service';
import { RpcProviderService } from './rpc-provider.service';
import { STALE_EMERGENCY_PROCESSING_MS } from './emergency-bc-withdraw';

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

jest.mock('../mpc/eth-transfer', () => {
  const actual = jest.requireActual('../mpc/eth-transfer');
  return {
    ...actual,
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
    prepareErc20FullBalanceTransfer: jest.fn(async () => {
      throw new Error('ZERO_TOKEN_BALANCE');
    }),
    serializeSignedTransfer: jest.fn(() => '0xsignedraw'),
    signedRawTxHash: jest.fn(() => '0xabc'),
  };
});

jest.mock('./erc20-balance', () => ({
  getConfiguredTestTokenAddress: jest.fn(() => null),
}));

import { signDigestBcRelay } from '../mpc/bc-sign-relay';
import {
  prepareErc20FullBalanceTransfer,
  signedRawTxHash,
} from '../mpc/eth-transfer';
import { getConfiguredTestTokenAddress } from './erc20-balance';

const DEST = '0x2222222222222222222222222222222222222222';
const TOKEN = '0xc3CF22f1a32f360B685C56Da48481007d580cDb4';

describe('EmergencyLastWithdrawService', () => {
  let service: EmergencyLastWithdrawService;
  let prisma: any;
  let rows: any[];
  let recovery: { retireShareC: jest.Mock };
  let emergencyOtp: { verifyEmergencyOtp: jest.Mock };
  let rpc: { getProvider: jest.Mock };
  let getTransactionReceipt: jest.Mock;
  let broadcastTransaction: jest.Mock;

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
    rows = [];
    (getConfiguredTestTokenAddress as jest.Mock).mockReturnValue(null);
    (prepareErc20FullBalanceTransfer as jest.Mock).mockImplementation(
      async () => {
        throw new Error('ZERO_TOKEN_BALANCE');
      },
    );
    (signedRawTxHash as jest.Mock).mockReturnValue('0xabc');

    prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
        update: jest.fn().mockResolvedValue({}),
      },
      withdrawRequest: {
        findMany: jest.fn(async ({ where }: any = {}) => {
          const statuses: string[] | undefined = where?.status?.in;
          return rows.filter((row) =>
            statuses ? statuses.includes(row.status) : true,
          );
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          return rows.find((row) => row.id === where.id) ?? null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) return { id: where.id, ...data };
          Object.assign(row, data);
          return row;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `wr${rows.length + 1}`,
            createdAt: new Date(),
            txHash: null,
            ...data,
          };
          rows.push(row);
          return row;
        }),
      },
      withdrawalAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'w1' }]),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    recovery = {
      retireShareC: jest.fn().mockResolvedValue({ status: 'RETIRED' }),
    };
    emergencyOtp = {
      verifyEmergencyOtp: jest.fn().mockResolvedValue(undefined),
    };
    getTransactionReceipt = jest.fn().mockResolvedValue(null);
    broadcastTransaction = jest.fn().mockResolvedValue({
      hash: '0xabc',
      wait: jest.fn().mockResolvedValue({}),
    });
    rpc = {
      getProvider: jest.fn().mockReturnValue({
        getTransactionReceipt,
        broadcastTransaction,
      }),
    };

    service = new EmergencyLastWithdrawService(
      prisma as unknown as PrismaService,
      rpc as unknown as RpcProviderService,
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
      service.executeLastWithdraw('u1', 'w1', DEST, '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('executes B+C relay last withdraw and retires wallet', async () => {
    const result = await service.executeLastWithdraw('u1', 'w1', DEST, '123456');

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
    expect(broadcastTransaction).toHaveBeenCalledWith('0xsignedraw');
    expect(prisma.withdrawRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    );
    expect(prisma.withdrawRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'BROADCASTED',
          txHash: '0xabc',
        }),
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

  it('sweeps TTK then ETH and retires', async () => {
    (getConfiguredTestTokenAddress as jest.Mock).mockReturnValue(TOKEN);
    (prepareErc20FullBalanceTransfer as jest.Mock).mockResolvedValue({
      tx: Transaction.from({
        type: 2,
        to: TOKEN,
        value: 0n,
        nonce: 0,
        gasLimit: 100000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        chainId: 11155111,
        data: '0xa9059cbb',
      }),
      tokenAmount: 1000n,
      balanceWei: 100n,
      feeWei: 50n,
      valueWei: 0n,
    });
    (signedRawTxHash as jest.Mock)
      .mockReturnValueOnce('0xtoken')
      .mockReturnValueOnce('0xeth');
    broadcastTransaction
      .mockResolvedValueOnce({
        hash: '0xtoken',
        wait: jest.fn().mockResolvedValue({}),
      })
      .mockResolvedValueOnce({
        hash: '0xeth',
        wait: jest.fn().mockResolvedValue({}),
      });

    const result = await service.executeLastWithdraw('u1', 'w1', DEST, '123456');

    expect(signDigestBcRelay).toHaveBeenCalledTimes(2);
    expect(broadcastTransaction).toHaveBeenCalledTimes(2);
    expect(prisma.withdrawRequest.create).toHaveBeenCalledTimes(2);
    expect(result.tokenWithdraw?.txHash).toBe('0xtoken');
    expect(result.withdraw.txHash).toBe('0xeth');
    expect(result.message).toMatch(/TTK와 ETH/);
    expect(recovery.retireShareC).toHaveBeenCalled();
  });

  it('aborts without RETIRED when TTK remains but ETH gas is insufficient', async () => {
    (getConfiguredTestTokenAddress as jest.Mock).mockReturnValue(TOKEN);
    (prepareErc20FullBalanceTransfer as jest.Mock).mockRejectedValue(
      new Error('INSUFFICIENT_GAS'),
    );

    await expect(
      service.executeLastWithdraw('u1', 'w1', DEST, '123456'),
    ).rejects.toMatchObject({
      response: {
        code: MpcErrorCode.INSUFFICIENT_GAS,
        message: expect.stringMatching(/지갑은 폐기되지 않았습니다/),
      },
    });

    expect(emergencyOtp.verifyEmergencyOtp).toHaveBeenCalled();
    expect(signDigestBcRelay).not.toHaveBeenCalled();
    expect(recovery.retireShareC).not.toHaveBeenCalled();
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('persists BROADCASTED before wait and does not RETIRE if wait fails', async () => {
    broadcastTransaction.mockResolvedValue({
      hash: '0xabc',
      wait: jest.fn().mockRejectedValue(new Error('timeout')),
    });

    await expect(
      service.executeLastWithdraw('u1', 'w1', DEST, '123456'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.withdrawRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'BROADCASTED',
          txHash: '0xabc',
        }),
      }),
    );
    expect(recovery.retireShareC).not.toHaveBeenCalled();
    expect(prisma.wallet.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: WalletStatus.RETIRED }),
      }),
    );
    const stored = rows.find((r) => r.status === 'BROADCASTED');
    expect(stored?.metadata?.signedRaw).toBe('0xsignedraw');
  });

  it('rebroadcasts stored raw on BROADCASTED retry and does not re-sign', async () => {
    rows.push({
      id: 'wr-bc',
      status: 'BROADCASTED',
      txHash: '0xabc',
      amount: '79',
      toAddress: DEST,
      createdAt: new Date(),
      metadata: {
        mode: 'EMERGENCY_BC_RELAY',
        asset: 'ETH',
        signedRaw: '0xsignedraw',
      },
    });

    await expect(
      service.executeLastWithdraw('u1', 'w1', DEST, '123456'),
    ).rejects.toMatchObject({
      response: { code: MpcErrorCode.TRANSACTION_PENDING },
    });

    expect(signDigestBcRelay).not.toHaveBeenCalled();
    expect(broadcastTransaction).toHaveBeenCalledWith('0xsignedraw');
    expect(recovery.retireShareC).not.toHaveBeenCalled();
  });

  it('409s fresh PROCESSING without txHash instead of resigning', async () => {
    rows.push({
      id: 'wr-live',
      status: 'PROCESSING',
      txHash: null,
      amount: '79',
      toAddress: DEST,
      createdAt: new Date(),
      metadata: { mode: 'EMERGENCY_BC_RELAY', asset: 'ETH' },
    });

    await expect(
      service.executeLastWithdraw('u1', 'w1', DEST, '123456'),
    ).rejects.toMatchObject({
      response: { code: MpcErrorCode.SIGN_SESSION_BUSY },
    });
    expect(signDigestBcRelay).not.toHaveBeenCalled();
  });

  it('fails stale PROCESSING then signs a new step', async () => {
    rows.push({
      id: 'wr-stale',
      status: 'PROCESSING',
      txHash: null,
      amount: '79',
      toAddress: DEST,
      createdAt: new Date(Date.now() - STALE_EMERGENCY_PROCESSING_MS - 1000),
      metadata: { mode: 'EMERGENCY_BC_RELAY', asset: 'ETH' },
    });

    const result = await service.executeLastWithdraw('u1', 'w1', DEST, '123456');

    expect(prisma.withdrawRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wr-stale' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(signDigestBcRelay).toHaveBeenCalledTimes(1);
    expect(result.withdraw.txHash).toBe('0xabc');
  });

  it('does not start ETH while TTK is still BROADCASTED', async () => {
    (getConfiguredTestTokenAddress as jest.Mock).mockReturnValue(TOKEN);
    rows.push({
      id: 'wr-token',
      status: 'BROADCASTED',
      txHash: '0xtoken',
      amount: '1000',
      toAddress: DEST,
      createdAt: new Date(),
      metadata: {
        mode: 'EMERGENCY_BC_RELAY',
        asset: 'ERC20',
        signedRaw: '0xtokenraw',
      },
    });

    await expect(
      service.executeLastWithdraw('u1', 'w1', DEST, '123456'),
    ).rejects.toMatchObject({
      response: { code: MpcErrorCode.TRANSACTION_PENDING },
    });
    expect(signDigestBcRelay).not.toHaveBeenCalled();
    expect(broadcastTransaction).toHaveBeenCalledWith('0xtokenraw');
  });

  it('rejects last withdraw while A+B PROCESSING is open', async () => {
    rows.push({
      id: 'wr-ab',
      status: 'PROCESSING',
      txHash: null,
      metadata: { mode: 'NORMAL_AB' },
    });

    await expect(
      service.executeLastWithdraw('u1', 'w1', DEST, '123456'),
    ).rejects.toMatchObject({
      response: { code: MpcErrorCode.SIGN_SESSION_BUSY },
    });
    expect(signDigestBcRelay).not.toHaveBeenCalled();
  });

  it('rejects last withdraw while A+B BROADCASTED has no receipt', async () => {
    rows.push({
      id: 'wr-ab',
      status: 'BROADCASTED',
      txHash: '0xabctx',
      metadata: { mode: 'NORMAL_AB' },
    });
    getTransactionReceipt.mockResolvedValue(null);

    await expect(
      service.executeLastWithdraw('u1', 'w1', DEST, '123456'),
    ).rejects.toMatchObject({
      response: { code: MpcErrorCode.TRANSACTION_PENDING },
    });
    expect(signDigestBcRelay).not.toHaveBeenCalled();
  });

  it('settles successful BROADCASTED receipt then last-withdraws', async () => {
    rows.push({
      id: 'wr-ab',
      status: 'BROADCASTED',
      txHash: '0xabctx',
      metadata: { mode: 'NORMAL_AB' },
    });
    getTransactionReceipt.mockResolvedValue({ status: 1 });

    const result = await service.executeLastWithdraw('u1', 'w1', DEST, '123456');

    expect(prisma.withdrawRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wr-ab' },
        data: expect.objectContaining({ status: 'EXECUTED' }),
      }),
    );
    expect(result.withdraw.txHash).toBe('0xabc');
  });
});
