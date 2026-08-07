import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient, WalletStatus, WalletType } from '@prisma/client';

config({ path: resolve(__dirname, '../../.env') });

/**
 * Lightweight DB smoke checks for STEP 2 schema.
 * Skips automatically when DATABASE_URL is unset.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('MPC Wallet Prisma schema (STEP 2)', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('exposes WalletStatus and optional Share B fields', async () => {
    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; data_type: string; udt_name: string }>
    >`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'Wallet'
        AND column_name IN ('status', 'mpcPublicKey', 'encryptedShareB', 'retiredAt')
      ORDER BY column_name
    `;

    const names = columns.map((c) => c.column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'encryptedShareB',
        'mpcPublicKey',
        'retiredAt',
        'status',
      ]),
    );
  });

  it('allows a second MPC wallet after retiring the first (partial unique)', async () => {
    const email = `mpc-step2-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test',
        status: 'ACTIVE',
      },
    });

    try {
      const first = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletType: WalletType.MPC,
          status: WalletStatus.ACTIVE,
          address: '0x1111111111111111111111111111111111111111',
          mpcPublicKey: '0x03aa',
          encryptedShareB: 'iv:tag:cipher',
        },
      });

      await expect(
        prisma.wallet.create({
          data: {
            userId: user.id,
            walletType: WalletType.MPC,
            status: WalletStatus.ACTIVE,
            address: '0x2222222222222222222222222222222222222222',
          },
        }),
      ).rejects.toThrow();

      await prisma.wallet.update({
        where: { id: first.id },
        data: {
          status: WalletStatus.RETIRED,
          retiredAt: new Date(),
          encryptedShareB: null,
        },
      });

      const second = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletType: WalletType.MPC,
          status: WalletStatus.ACTIVE,
          address: '0x3333333333333333333333333333333333333333',
          mpcPublicKey: '0x03bb',
          encryptedShareB: 'iv:tag:cipher2',
        },
      });

      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe(WalletStatus.ACTIVE);

      const audit = await prisma.withdrawalAuditLog.create({
        data: {
          walletId: second.id,
          userId: user.id,
          eventType: 'MPC_WALLET_CREATED',
          actorType: 'USER',
          actorId: user.id,
          message: 'schema allows null withdrawRequestId',
        },
      });
      expect(audit.withdrawRequestId).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
