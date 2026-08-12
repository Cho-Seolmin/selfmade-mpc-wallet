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
  return {
    ...actual,
    prepareAmountTransfer: jest.fn(async () => ({
      tx,
      balanceWei: 10n ** 18n,
      feeWei: 21000n,
      valueWei: 10n ** 15n,
    })),
    unsignedTxDigest32: jest.fn(() => {
      try {
        return getBytes(tx.unsignedHash);
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
        findMany: jest.fn(async ({ where }: any) => {
          return [...withdrawStore.values()].filter((row) => {
            if (where.walletId && row.walletId !== where.walletId) return false;
            if (where.status && row.status !== where.status) return false;
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

    const rpc = {
      getProvider: jest.fn().mockReturnValue({
        broadcastTransaction: jest.fn().mockResolvedValue({
          hash: '0xabctx',
          wait: jest.fn().mockResolvedValue({}),
        }),
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

      const retried = await service.complete('u1', started.sessionId, msg4A);
      expect(retried.withdraw.txHash).toBe('0xabctx');
      expect(retried.message).toContain('이미 완료');
    } finally {
      sessionA.free();
    }
  });
});
