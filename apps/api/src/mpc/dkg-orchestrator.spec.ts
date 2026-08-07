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
import { DkgOrchestratorService } from './dkg-orchestrator.service';
import { RecoveryClientService } from './recovery-client.service';
import { KeygenSession, Message } from './wasm';
import { PrismaService } from '../prisma/prisma.service';

config({ path: resolve(__dirname, '../../.env') });

/**
 * End-to-end DKG against a running Recovery Server.
 * Skips when RECOVERY_BASE_URL is unset or Recovery /health is down.
 */
const describeE2E = process.env.RECOVERY_BASE_URL ? describe : describe.skip;

describeE2E('DKG orchestrator (party A simulated in Node)', () => {
  const prisma = new PrismaService();
  const recovery = new RecoveryClientService();
  let orchestrator: DkgOrchestratorService;
  let userId: string;

  beforeAll(async () => {
    await prisma.$connect();
    orchestrator = new DkgOrchestratorService(prisma, recovery);

    const healthy = await fetch(
      `${process.env.RECOVERY_BASE_URL!.replace(/\/$/, '')}/health`,
    )
      .then((r) => r.ok)
      .catch(() => false);
    if (!healthy) {
      throw new Error(
        'Recovery Server is not reachable — start apps/recovery before this test',
      );
    }

    const user = await prisma.user.create({
      data: {
        email: `dkg-e2e-${Date.now()}@example.com`,
        passwordHash: 'x',
        status: 'ACTIVE',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('creates ACTIVE MPC wallet with Share B stored and Share C on Recovery', async () => {
    const sessionA = new KeygenSession(
      MPC_PARTIES,
      MPC_THRESHOLD,
      MPC_PARTY.A,
    );

    const msg1A = encodeWireMessages([sessionA.createFirstMessage()])[0];
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
        commitments as any,
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
    expect(shareA.partyId).toBe(0);
    const pkA = Buffer.from(shareA.publicKey).toString('hex');
    shareA.free();

    const completed = await orchestrator.complete(userId, started.sessionId);
    expect(completed.wallet.status).toBe(WalletStatus.ACTIVE);
    expect(completed.wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const row = await prisma.wallet.findUnique({
      where: { id: completed.wallet.id },
    });
    expect(row?.encryptedShareB).toBeTruthy();
    expect(row?.mpcPublicKey?.toLowerCase()).toContain(pkA.slice(0, 10));

    const meta = await fetch(
      `${process.env.RECOVERY_BASE_URL!.replace(/\/$/, '')}/shares/${completed.wallet.id}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.RECOVERY_SERVICE_TOKEN}`,
        },
      },
    ).then((r) => r.json());
    expect(meta.hasEncryptedShare).toBe(true);
    expect(meta.partyId).toBe(2);
  }, 60_000);
});
