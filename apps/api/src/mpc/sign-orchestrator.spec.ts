import { BadRequestException, ConflictException } from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { Transaction, getBytes, keccak256 } from 'ethers';
import {
  MPC_CHAIN_PATH,
  MPC_PARTY,
  base64ToBytes,
  decodeWireMessages,
  encodeWireMessages,
  ethAddressFromPublicKey,
  filterMessages,
  runInProcessDkg,
  selectMessages,
} from '@selfmade/mpc-crypto';
import { AuditService } from '../audit/audit.service';
import { encryptShareB } from '../common/crypto/share-b-encryption';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { RpcProviderService } from '../wallet/rpc-provider.service';
import { SignOrchestratorService } from './sign-orchestrator.service';
import { KeygenSession, Keyshare, Message, SignSession } from './wasm';

jest.mock('./eth-transfer', () => {
  const actual = jest.requireActual('./eth-transfer');
  const digest = getBytes(
    keccak256(Buffer.from('selfmade-ab-sign-test-digest')),
  );
  const tx = Transaction.from({
    type: 2,
    to: '0x2222222222222222222222222222222222222222',
    value: 10n ** 15n,
    nonce: 0,
    gasLimit: 21000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    chainId: 11155111,
  });
  const token = '0xc3CF22f1a32f360B685C56Da48481007d580cDb4';
  const erc20Tx = Transaction.from({
    type: 2,
    to: token,
    value: 0n,
    nonce: 0,
    gasLimit: 100000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    chainId: 11155111,
    data: actual.encodeErc20Transfer(
      '0x2222222222222222222222222222222222222222',
      10n ** 15n,
    ),
  });
  return {
    ...actual,
    prepareAmountTransfer: jest.fn(async () => ({
      tx,
      balanceWei: 10n ** 18n,
      feeWei: 21000n,
      valueWei: 10n ** 15n,
    })),
    prepareErc20AmountTransfer: jest.fn(async () => ({
      tx: erc20Tx,
      balanceWei: 10n ** 18n,
      feeWei: 100000n,
      valueWei: 0n,
    })),
    unsignedTxDigest32: jest.fn((inputTx?: Transaction) => {
      try {
        return getBytes((inputTx ?? tx).unsignedHash);
      } catch {
        return digest;
      }
    }),
    serializeSignedTransfer: jest.fn(() => '0xsignedraw'),
  };
});

describe('SignOrchestratorService A+B rounds', () => {
  let service: SignOrchestratorService;
  let prisma: any;
  let shareABytes: Uint8Array;
  let encryptedShareB: string;
  let address: string;
  let withdrawStore: Map<string, any>;
  let broadcastTransaction: jest.Mock;
  let waitReceipt: jest.Mock;
  let getTransactionReceipt: jest.Mock;

  beforeAll(() => {
    if (!process.env.WALLET_ENCRYPTION_KEY) {
      process.env.WALLET_ENCRYPTION_KEY = 'a'.repeat(64);
    }
    const shares = runInProcessDkg(KeygenSession, {
      participants: 3,
      threshold: 2,
    });
    try {
      const a = shares.find((s) => s.partyId === MPC_PARTY.A)!;
      const b = shares.find((s) => s.partyId === MPC_PARTY.B)!;
      shareABytes = new Uint8Array(a.toBytes());
      encryptedShareB = encryptShareB(Buffer.from(b.toBytes()));
      address = ethAddressFromPublicKey(a.publicKey);
    } finally {
      shares.forEach((s) => s.free());
    }
  });

  beforeEach(() => {
    withdrawStore = new Map();
    prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'w1',
          userId: 'u1',
          walletType: 'MPC',
          status: WalletStatus.ACTIVE,
          address,
          encryptedShareB,
        }),
      },
      withdrawRequest: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.idempotencyKey) {
            for (const row of withdrawStore.values()) {
              if (row.idempotencyKey === where.idempotencyKey) return row;
            }
            return null;
          }
          if (where.id) return withdrawStore.get(where.id) ?? null;
          return null;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          return (
            [...withdrawStore.values()].find((row) => {
              if (where.wallet?.userId && row.userId !== where.wallet.userId) {
                return false;
              }
              if (where.status?.in && !where.status.in.includes(row.status)) {
                return false;
              }
              if (
                typeof where.status === 'string' &&
                row.status !== where.status
              ) {
                return false;
              }
              if (where.metadata?.path && where.metadata.equals !== undefined) {
                let cur: any = row.metadata;
                for (const key of where.metadata.path) {
                  cur = cur?.[key];
                }
                if (cur !== where.metadata.equals) return false;
              }
              return true;
            }) ?? null
          );
        }),
        findMany: jest.fn(async ({ where }: any) => {
          return [...withdrawStore.values()].filter((row) => {
            if (where.walletId && row.walletId !== where.walletId) return false;
            if (where.status?.in && !where.status.in.includes(row.status)) {
              return false;
            }
            if (
              typeof where.status === 'string' &&
              row.status !== where.status
            ) {
              return false;
            }
            if (where.wallet?.userId && row.userId !== where.wallet.userId) {
              return false;
            }
            if (where.createdAt?.lt && row.createdAt >= where.createdAt.lt) {
              return false;
            }
            return true;
          });
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `wr-${withdrawStore.size + 1}`,
            userId: 'u1',
            createdAt: new Date(),
            txHash: null,
            ...data,
          };
          withdrawStore.set(row.id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = withdrawStore.get(where.id);
          if (!row) return {};
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      withdrawalAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'w1' }]),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    waitReceipt = jest.fn().mockResolvedValue({});
    broadcastTransaction = jest.fn().mockResolvedValue({
      hash: '0xabctx',
      wait: waitReceipt,
    });
    getTransactionReceipt = jest.fn().mockResolvedValue(null);
    const rpc = {
      getProvider: jest.fn().mockReturnValue({
        broadcastTransaction,
        getTransactionReceipt,
      }),
    };

    service = new SignOrchestratorService(
      prisma as unknown as PrismaService,
      rpc as unknown as RpcProviderService,
      new AuditService(prisma as unknown as PrismaService),
    );
  });

  it('rejects non-ACTIVE wallets', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      walletType: 'MPC',
      status: WalletStatus.RECOVERY_PENDING,
      address,
      encryptedShareB,
    });
    await expect(
      service.start(
        'u1',
        'w1',
        '0x2222222222222222222222222222222222222222',
        '0.001',
        'key-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing Idempotency-Key', async () => {
    await expect(
      service.start(
        'u1',
        'w1',
        '0x2222222222222222222222222222222222222222',
        '0.001',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reuses start for same Idempotency-Key and body', async () => {
    const a = await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.001',
      'same-key',
    );
    const b = await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.001',
      'same-key',
    );
    expect(b.sessionId).toBe(a.sessionId);
    expect(b.reused).toBe(true);
    expect(b.tx).toEqual(a.tx);
    expect(a.tx.to.toLowerCase()).toBe(
      '0x2222222222222222222222222222222222222222',
    );
    expect(withdrawStore.size).toBe(1);
  });

  it('conflicts when Idempotency-Key is reused with different body', async () => {
    await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.001',
      'conflict-key',
    );
    await expect(
      service.start(
        'u1',
        'w1',
        '0x3333333333333333333333333333333333333333',
        '0.5',
        'conflict-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('limits to one PROCESSING NORMAL_AB session per wallet', async () => {
    await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.001',
      'key-a',
    );
    await expect(
      service.start(
        'u1',
        'w1',
        '0x2222222222222222222222222222222222222222',
        '0.002',
        'key-b',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('completes A+B signing rounds and returns EXECUTED on complete retry', async () => {
    const started = await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.001',
      'complete-key',
    );
    if (started.alreadyBroadcast) {
      throw new Error('expected a signing session');
    }

    const keyshareA = Keyshare.fromBytes(shareABytes);
    const sessionA = new SignSession(keyshareA, MPC_CHAIN_PATH);
    try {
      const msg1A = encodeWireMessages([sessionA.createFirstMessage()]);
      const msg1All = decodeWireMessages(Message, [
        started.msg1B,
        ...msg1A,
      ]);
      const msg2A = encodeWireMessages(
        sessionA.handleMessages(filterMessages(msg1All, MPC_PARTY.A)),
      );

      const r1 = await service.round1('u1', started.sessionId, msg1A);
      const msg3A = encodeWireMessages(
        sessionA.handleMessages(
          selectMessages(
            decodeWireMessages(Message, [...msg2A, ...r1.messagesForA]),
            MPC_PARTY.A,
          ),
        ),
      );

      const r2 = await service.round2('u1', started.sessionId, msg2A);
      sessionA.handleMessages(
        selectMessages(
          decodeWireMessages(Message, [...msg3A, ...r2.messagesForA]),
          MPC_PARTY.A,
        ),
      );

      await service.round3('u1', started.sessionId, msg3A);

      const digest = base64ToBytes(started.digestB64);
      const msg4A = encodeWireMessages([sessionA.lastMessage(digest)]);
      const done = await service.complete('u1', started.sessionId, msg4A);

      expect(done.withdraw.status).toBe('EXECUTED');
      expect(done.withdraw.txHash).toBe('0xabctx');
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      const retried = await service.complete('u1', started.sessionId, msg4A);
      expect(retried.withdraw.status).toBe('EXECUTED');
      expect(retried.withdraw.txHash).toBe('0xabctx');
      expect(retried.message).toContain('이미 완료');
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(waitReceipt).toHaveBeenCalledTimes(1);
    } finally {
      sessionA.free();
    }
  });

  it('keeps BROADCASTED after wait failure and does not rebroadcast on retry', async () => {
    waitReceipt.mockRejectedValueOnce(new Error('receipt timeout'));

    const started = await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.001',
      'broadcast-key',
    );
    if (started.alreadyBroadcast) {
      throw new Error('expected a signing session');
    }

    const keyshareA = Keyshare.fromBytes(shareABytes);
    const sessionA = new SignSession(keyshareA, MPC_CHAIN_PATH);
    try {
      const msg1A = encodeWireMessages([sessionA.createFirstMessage()]);
      const msg1All = decodeWireMessages(Message, [
        started.msg1B,
        ...msg1A,
      ]);
      const msg2A = encodeWireMessages(
        sessionA.handleMessages(filterMessages(msg1All, MPC_PARTY.A)),
      );

      const r1 = await service.round1('u1', started.sessionId, msg1A);
      const msg3A = encodeWireMessages(
        sessionA.handleMessages(
          selectMessages(
            decodeWireMessages(Message, [...msg2A, ...r1.messagesForA]),
            MPC_PARTY.A,
          ),
        ),
      );

      const r2 = await service.round2('u1', started.sessionId, msg2A);
      sessionA.handleMessages(
        selectMessages(
          decodeWireMessages(Message, [...msg3A, ...r2.messagesForA]),
          MPC_PARTY.A,
        ),
      );

      await service.round3('u1', started.sessionId, msg3A);

      const digest = base64ToBytes(started.digestB64);
      const msg4A = encodeWireMessages([sessionA.lastMessage(digest)]);
      const done = await service.complete('u1', started.sessionId, msg4A);

      expect(done.withdraw.status).toBe('BROADCASTED');
      expect(done.withdraw.txHash).toBe('0xabctx');
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      const retried = await service.complete('u1', started.sessionId, msg4A);
      expect(retried.withdraw.status).toBe('BROADCASTED');
      expect(retried.withdraw.txHash).toBe('0xabctx');
      expect(retried.message).toContain('이미 브로드캐스트');
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(waitReceipt).toHaveBeenCalledTimes(1);

      const reusedStart = await service.start(
        'u1',
        'w1',
        '0x2222222222222222222222222222222222222222',
        '0.001',
        'broadcast-key',
      );
      expect(reusedStart.alreadyBroadcast).toBe(true);
      if (reusedStart.alreadyBroadcast) {
        expect(reusedStart.withdraw.txHash).toBe('0xabctx');
        expect(reusedStart.withdraw.status).toBe('BROADCASTED');
      }

      const nextPending = service.start(
        'u1',
        'w1',
        '0x2222222222222222222222222222222222222222',
        '0.002',
        'next-key',
      );
      await expect(nextPending).rejects.toMatchObject({
        response: { code: MpcErrorCode.TRANSACTION_PENDING },
      });
      expect(withdrawStore.size).toBe(1);
    } finally {
      sessionA.free();
    }
  });

  it('starts a new withdraw after BROADCASTED receipt confirms', async () => {
    withdrawStore.set('wr-old', {
      id: 'wr-old',
      walletId: 'w1',
      userId: 'u1',
      status: 'BROADCASTED',
      txHash: '0xabctx',
      idempotencyKey: 'old-key',
      amount: '1000000000000000',
      toAddress: '0x2222222222222222222222222222222222222222',
      metadata: { mode: 'NORMAL_AB', sessionId: 's-old' },
      createdAt: new Date(),
    });
    getTransactionReceipt.mockResolvedValue({ status: 1 });

    const next = await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.002',
      'next-key',
    );

    expect(next.alreadyBroadcast).toBeFalsy();
    expect(withdrawStore.get('wr-old').status).toBe('EXECUTED');
    expect(withdrawStore.size).toBe(2);
  });

  it('starts a new withdraw after BROADCASTED receipt reverts', async () => {
    withdrawStore.set('wr-old', {
      id: 'wr-old',
      walletId: 'w1',
      userId: 'u1',
      status: 'BROADCASTED',
      txHash: '0xabctx',
      idempotencyKey: 'old-key',
      amount: '1000000000000000',
      toAddress: '0x2222222222222222222222222222222222222222',
      metadata: { mode: 'NORMAL_AB', sessionId: 's-old' },
      createdAt: new Date(),
    });
    getTransactionReceipt.mockResolvedValue({ status: 0 });

    const next = await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.002',
      'next-key',
    );

    expect(next.alreadyBroadcast).toBeFalsy();
    expect(withdrawStore.get('wr-old').status).toBe('FAILED');
    expect(withdrawStore.size).toBe(2);
  });

  it('starts ERC-20 withdraw against the configured token contract', async () => {
    process.env.SEPOLIA_TEST_TOKEN_ADDRESS =
      '0xc3CF22f1a32f360B685C56Da48481007d580cDb4';
    const started = await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.001',
      'erc20-key',
      'ERC20',
    );
    if (started.alreadyBroadcast) {
      throw new Error('expected a signing session');
    }
    expect(started.tx.to.toLowerCase()).toBe(
      '0xc3cf22f1a32f360b685c56da48481007d580cdb4',
    );
    expect(started.tx.value).toBe('0');
    expect(started.tx.data.toLowerCase()).toMatch(/^0xa9059cbb/);
  });

  it('rejects sign/start when wallet leaves ACTIVE under the lock', async () => {
    prisma.wallet.findUnique
      .mockResolvedValueOnce({
        id: 'w1',
        userId: 'u1',
        walletType: 'MPC',
        status: WalletStatus.ACTIVE,
        address,
        encryptedShareB,
      })
      .mockResolvedValueOnce({
        id: 'w1',
        status: WalletStatus.RECOVERY_PENDING,
      });

    await expect(
      service.start(
        'u1',
        'w1',
        '0x2222222222222222222222222222222222222222',
        '0.001',
        'race-key',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withdrawStore.size).toBe(0);
  });

  it('does not broadcast A+B complete after wallet leaves ACTIVE', async () => {
    const started = await service.start(
      'u1',
      'w1',
      '0x2222222222222222222222222222222222222222',
      '0.001',
      'not-active-key',
    );
    if (started.alreadyBroadcast) {
      throw new Error('expected a signing session');
    }

    const keyshareA = Keyshare.fromBytes(shareABytes);
    const sessionA = new SignSession(keyshareA, MPC_CHAIN_PATH);
    try {
      const msg1A = encodeWireMessages([sessionA.createFirstMessage()]);
      const msg1All = decodeWireMessages(Message, [
        started.msg1B,
        ...msg1A,
      ]);
      const msg2A = encodeWireMessages(
        sessionA.handleMessages(filterMessages(msg1All, MPC_PARTY.A)),
      );
      const r1 = await service.round1('u1', started.sessionId, msg1A);
      const msg3A = encodeWireMessages(
        sessionA.handleMessages(
          selectMessages(
            decodeWireMessages(Message, [...msg2A, ...r1.messagesForA]),
            MPC_PARTY.A,
          ),
        ),
      );
      const r2 = await service.round2('u1', started.sessionId, msg2A);
      sessionA.handleMessages(
        selectMessages(
          decodeWireMessages(Message, [...msg3A, ...r2.messagesForA]),
          MPC_PARTY.A,
        ),
      );
      await service.round3('u1', started.sessionId, msg3A);

      prisma.wallet.findUnique.mockResolvedValue({
        id: 'w1',
        userId: 'u1',
        walletType: 'MPC',
        status: WalletStatus.RECOVERY_PENDING,
        address,
        encryptedShareB,
      });

      const digest = base64ToBytes(started.digestB64);
      const msg4A = encodeWireMessages([sessionA.lastMessage(digest)]);
      await expect(
        service.complete('u1', started.sessionId, msg4A),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(broadcastTransaction).not.toHaveBeenCalled();
    } finally {
      sessionA.free();
    }
  });
});
