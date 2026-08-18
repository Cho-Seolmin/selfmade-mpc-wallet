import { GoneException } from '@nestjs/common';
import { TotpService } from './totp.service';
import { encryptTotpSecret } from '../common/crypto/totp-encryption';
import { generateTotpSecret } from './totp.util';
import { randomBytes } from 'crypto';

describe('TotpService one-time reveal', () => {
  const userId = 'u1';
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let service: TotpService;

  beforeEach(() => {
    process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: userId }]),
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => unknown) =>
        fn(prisma),
      ),
    };
    service = new TotpService(prisma as any);
  });

  it('getSetupStatus does not expose secret', async () => {
    prisma.user.findUnique.mockResolvedValue({
      encryptedTotpSecret: 'enc',
      totpSecretRevealedAt: null,
    });
    await expect(service.getSetupStatus(userId)).resolves.toEqual({
      configured: true,
      alreadyRevealed: false,
    });
  });

  it('revealSetupOnce returns secret once then GoneException', async () => {
    const secret = generateTotpSecret();
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: userId,
        email: 'a@b.com',
        encryptedTotpSecret: null,
        totpSecretRevealedAt: null,
      })
      .mockResolvedValueOnce({
        id: userId,
        email: 'a@b.com',
        encryptedTotpSecret: encryptTotpSecret(secret),
        totpSecretRevealedAt: new Date(),
      });

    const first = await service.revealSetupOnce(userId, 'a@b.com');
    expect(first.secret).toBeTruthy();
    expect(first.otpauthUrl).toContain('otpauth://');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totpSecretRevealedAt: expect.any(Date),
          encryptedTotpSecret: expect.any(String),
        }),
      }),
    );

    await expect(service.revealSetupOnce(userId, 'a@b.com')).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('allows one reveal for existing unrevealed secret', async () => {
    const secret = generateTotpSecret();
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'a@b.com',
      encryptedTotpSecret: encryptTotpSecret(secret),
      totpSecretRevealedAt: null,
    });

    const revealed = await service.revealSetupOnce(userId, 'a@b.com');
    expect(revealed.secret).toBe(secret);
    expect(revealed.created).toBe(false);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { totpSecretRevealedAt: expect.any(Date) },
      }),
    );
  });

  it('locks the user row before reveal so concurrent calls serialize', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'a@b.com',
      encryptedTotpSecret: null,
      totpSecretRevealedAt: null,
    });

    await service.revealSetupOnce(userId, 'a@b.com');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(JSON.stringify(prisma.$queryRaw.mock.calls[0])).toMatch(
      /FOR UPDATE/i,
    );
  });
});
