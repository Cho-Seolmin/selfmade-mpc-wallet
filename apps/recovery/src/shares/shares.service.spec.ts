import { config } from 'dotenv';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { Test } from '@nestjs/testing';
import { SharesService } from './shares.service';
import { PrismaService } from '../prisma/prisma.service';

config({ path: resolve(__dirname, '../../.env') });

describe('SharesService', () => {
  let service: SharesService;
  let prisma: PrismaService;

  beforeAll(async () => {
    if (!process.env.RECOVERY_ENCRYPTION_KEY) {
      process.env.RECOVERY_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    }

    const moduleRef = await Test.createTestingModule({
      providers: [SharesService, PrismaService],
    }).compile();

    service = moduleRef.get(SharesService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    await prisma.mpcRecoveryShare.deleteMany();
  });

  afterAll(async () => {
    await prisma.mpcRecoveryShare.deleteMany();
    await prisma.$disconnect();
  });

  it('stores encrypted Share C; plaintext only via in-process load (never HTTP export)', async () => {
    const shareBytes = randomBytes(96);
    const walletId = `wallet_${Date.now()}`;

    const meta = await service.upsertShareC({
      walletId,
      userId: 'user_1',
      mpcPublicKey:
        '0x03dc19356f4f6ee0b858f32cbddfa670a203b7a0eb662655f79daaca9b6d5b9055',
      shareCBase64: shareBytes.toString('base64'),
    });

    expect(meta.walletId).toBe(walletId);
    expect(meta.partyId).toBe(2);
    expect(meta.hasEncryptedShare).toBe(true);
    expect(meta).not.toHaveProperty('encryptedShareC');
    expect(meta).not.toHaveProperty('shareCBase64');

    const safe = await service.getShareMeta(walletId);
    expect(safe.hasEncryptedShare).toBe(true);

    const loaded = await service.loadActiveShareCBytes(walletId);
    expect(Buffer.compare(loaded, shareBytes)).toBe(0);
    loaded.fill(0);

    await expect(
      service.upsertShareC({
        walletId,
        userId: 'user_1',
        mpcPublicKey: meta.mpcPublicKey,
        shareCBase64: shareBytes.toString('base64'),
      }),
    ).rejects.toThrow(/already exists/);

    const retired = await service.retireShare(walletId);
    expect(retired.status).toBe('RETIRED');
    expect(retired.hasEncryptedShare).toBe(false);

    await expect(service.loadActiveShareCBytes(walletId)).rejects.toThrow(
      /not ACTIVE/,
    );
  });
});
