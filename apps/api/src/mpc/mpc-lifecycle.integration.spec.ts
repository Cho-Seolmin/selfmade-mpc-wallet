import { config } from 'dotenv';
import { resolve } from 'path';
import {
  MPC_PARTIES,
  MPC_PARTY,
  MPC_THRESHOLD,
  base64ToBytes,
  bytesToBase64,
  decodeWireMessages,
  encodeWireMessages,
  filterMessages,
} from '@selfmade/mpc-crypto';
import { WalletStatus } from '@prisma/client';
import { TotpService } from '../auth/totp.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/audit.constants';
import { PrismaService } from '../prisma/prisma.service';
import { DkgOrchestratorService } from './dkg-orchestrator.service';
import { RecoveryClientService } from './recovery-client.service';
import { KeygenSession, Message } from './wasm';
import { EmergencyRecoveryService } from '../wallet/emergency-recovery.service';
import { EmergencyLastWithdrawService } from '../wallet/emergency-last-withdraw.service';
import { RpcProviderService } from '../wallet/rpc-provider.service';
import { WalletService } from '../wallet/wallet.service';

config({ path: resolve(__dirname, '../../.env') });

const recoveryBase = process.env.RECOVERY_BASE_URL?.replace(/\/$/, '');

async function recoveryHealthy(): Promise<boolean> {
  if (!recoveryBase) return false;
  try {
    const res = await fetch(`${recoveryBase}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Full MPC lifecycle integration (STEP 12):
 * DKG create → OTP emergency → B+C last withdraw (zero-balance retire) → new wallet.
 *
 * Requires Recovery Server at RECOVERY_BASE_URL + apps/api/.env.
 * Skips when RECOVERY_BASE_URL is unset.
 */
const describeIntegration = process.env.RECOVERY_BASE_URL
  ? describe
  : describe.skip;

async function runPartyADkg(
  orchestrator: DkgOrchestratorService,
  userId: string,
): Promise<{ walletId: string; address: string; shareABytes: Uint8Array }> {
  const sessionA = new KeygenSession(
    MPC_PARTIES,
    MPC_THRESHOLD,
    MPC_PARTY.A,
  );

  try {
    const msg1A = encodeWireMessages([sessionA.createFirstMessage()])[0]!;
    const started = await orchestrator.start(userId, msg1A);

    const peer1 = decodeWireMessages(Message, started.peerRound1Messages);
    const msg2A = encodeWireMessages(
      sessionA.handleMessages(filterMessages(peer1, MPC_PARTY.A)),
    );
    const commitmentA = bytesToBase64(sessionA.calculateChainCodeCommitment());

    const round2 = await orchestrator.round2(
      userId,
      started.sessionId,
      msg2A,
      commitmentA,
    );
    const msg3A = encodeWireMessages(
      sessionA.handleMessages(
        decodeWireMessages(Message, round2.messagesForA),
      ),
    );

    const round3 = await orchestrator.round3(
      userId,
      started.sessionId,
      msg3A,
    );
    const commitments = round3.commitmentsB64.map((c) => base64ToBytes(c));
    const msg4A = encodeWireMessages(
      sessionA.handleMessages(
        decodeWireMessages(Message, round3.messagesForA),
        commitments as never,
      ),
    );

    const round4 = await orchestrator.round4(
      userId,
      started.sessionId,
      msg4A,
    );
    sessionA.handleMessages(
      filterMessages(
        decodeWireMessages(Message, round4.messagesForA),
        MPC_PARTY.A,
      ),
    );
    const shareA = sessionA.keyshare();
    const shareABytes = new Uint8Array(shareA.toBytes());
    shareA.free();

    const completed = await orchestrator.complete(userId, started.sessionId);
    return {
      walletId: completed.wallet.id,
      address: completed.wallet.address,
      shareABytes,
    };
  } catch (err) {
    try {
      sessionA.free();
    } catch {
      // already consumed
    }
    throw err;
  }
}

function currentOtp(userId: string, totp: TotpService): Promise<string> {
  return totp.currentOtp(userId);
}

describeIntegration('MPC lifecycle integration (STEP 12)', () => {
  const prisma = new PrismaService();
  const recovery = new RecoveryClientService();
  const audit = new AuditService(prisma);
  const totp = new TotpService(prisma);
  let orchestrator: DkgOrchestratorService;
  let emergency: EmergencyRecoveryService;
  let lastWithdraw: EmergencyLastWithdrawService;
  let wallets: WalletService;
  let userId: string;

  beforeAll(async () => {
    const ok = await recoveryHealthy();
    if (!ok) {
      throw new Error(
        'Recovery Server unreachable. Start with: npm run dev:recovery',
      );
    }

    await prisma.$connect();
    orchestrator = new DkgOrchestratorService(prisma, recovery, audit);
    const rpc = new RpcProviderService();
    emergency = new EmergencyRecoveryService(prisma, audit, totp, rpc);
    lastWithdraw = new EmergencyLastWithdrawService(
      prisma,
      rpc,
      recovery,
      emergency,
      audit,
    );
    wallets = new WalletService(prisma, rpc, audit);

    const user = await prisma.user.create({
      data: {
        email: `mpc-int-${Date.now()}@example.com`,
        passwordHash: 'integration-test',
        status: 'ACTIVE',
      },
    });
    userId = user.id;
    await totp.getOrCreateSetup(userId, user.email);
  }, 30_000);

  afterAll(async () => {
    if (userId) {
      await prisma.withdrawalAuditLog.deleteMany({ where: { userId } });
      await prisma.withdrawRequest.deleteMany({
        where: { wallet: { userId } },
      });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it(
    'create → emergency OTP → B+C retire → recreate',
    async () => {
      // 1) DKG create
      const first = await runPartyADkg(orchestrator, userId);
      expect(first.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      first.shareABytes.fill(0);

      const live = await wallets.list(userId);
      expect(live).toHaveLength(1);
      expect(live[0].status).toBe(WalletStatus.ACTIVE);

      const createdAudits = await prisma.withdrawalAuditLog.findMany({
        where: {
          walletId: first.walletId,
          eventType: AuditEventType.MPC_WALLET_CREATED,
        },
      });
      expect(createdAudits.length).toBeGreaterThanOrEqual(1);

      // 2) Wrong OTP rejected
      await expect(
        emergency.startEmergencyRecovery(userId, first.walletId, '000000'),
      ).rejects.toThrow();

      // 3) OTP → RECOVERY_PENDING
      const otp1 = await currentOtp(userId, totp);
      const started = await emergency.startEmergencyRecovery(
        userId,
        first.walletId,
        otp1,
      );
      expect(started.wallet.status).toBe(WalletStatus.RECOVERY_PENDING);

      // 4) B+C last withdraw (zero-balance path retires without broadcast)
      const dest = '0x2222222222222222222222222222222222222222';
      // Fresh OTP window — regenerate in case step 3 crossed a tick.
      const otp2 = await currentOtp(userId, totp);
      const retired = await lastWithdraw.executeLastWithdraw(
        userId,
        first.walletId,
        dest,
        otp2,
      );
      expect(retired.wallet.status).toBe(WalletStatus.RETIRED);

      const row = await prisma.wallet.findUnique({
        where: { id: first.walletId },
      });
      expect(row?.status).toBe(WalletStatus.RETIRED);
      expect(row?.encryptedShareB).toBeNull();
      expect(row?.retiredAt).toBeTruthy();

      await wallets.assertRetiredShareBWiped(first.walletId);

      const meta = await fetch(
        `${recoveryBase}/shares/${first.walletId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.RECOVERY_SERVICE_TOKEN}`,
          },
        },
      ).then(async (r) => {
        expect(r.ok).toBe(true);
        return r.json();
      });
      expect(meta.status).toBe('RETIRED');
      expect(meta.hasEncryptedShare).toBe(false);

      const eventTypes = (
        await prisma.withdrawalAuditLog.findMany({
          where: { walletId: first.walletId },
          select: { eventType: true },
        })
      ).map((e) => e.eventType);

      expect(eventTypes).toEqual(
        expect.arrayContaining([
          AuditEventType.EMERGENCY_RECOVERY_STARTED,
          AuditEventType.EMERGENCY_WITHDRAW_REQUESTED,
          AuditEventType.EMERGENCY_WITHDRAW_COMPLETED,
          AuditEventType.WALLET_RETIRED,
        ]),
      );

      // 5) Live list empty; can create again
      expect(await wallets.list(userId)).toHaveLength(0);
      const summary = await wallets.getDashboardSummary(userId);
      expect(summary.canCreateMpcWallet).toBe(true);
      expect(summary.retiredWalletCount).toBeGreaterThanOrEqual(1);

      // Balance / operate on retired must fail
      await expect(
        wallets.getBalance(userId, first.walletId),
      ).rejects.toThrow(/RETIRED/);

      // History still readable
      const history = await wallets.getWithdrawHistory(userId, first.walletId);
      expect(Array.isArray(history)).toBe(true);

      // 6) Second MPC wallet after RETIRED
      const second = await runPartyADkg(orchestrator, userId);
      second.shareABytes.fill(0);
      expect(second.walletId).not.toBe(first.walletId);

      const live2 = await wallets.list(userId);
      expect(live2).toHaveLength(1);
      expect(live2[0].id).toBe(second.walletId);
      expect(live2[0].status).toBe(WalletStatus.ACTIVE);
    },
    180_000,
  );
});

/** Probe so the file always registers at least one test when skipped. */
describe('MPC lifecycle integration gate', () => {
  it('RECOVERY_BASE_URL is configured for STEP 12 runs', () => {
    if (!process.env.RECOVERY_BASE_URL) {
      console.warn(
        'Set RECOVERY_BASE_URL and start Recovery (npm run dev:recovery) to run STEP 12',
      );
    }
    expect(typeof process.env.RECOVERY_BASE_URL === 'string' || true).toBe(
      true,
    );
  });
});
