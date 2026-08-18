import {
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  isTotpEncryptionConfigured,
} from '../common/crypto/totp-encryption';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildTotpAuthUrl,
  currentTotpToken,
  generateTotpSecret,
  verifyTotpToken,
} from './totp.util';

export type TotpSetupStatus = {
  configured: boolean;
  alreadyRevealed: boolean;
};

@Injectable()
export class TotpService {
  constructor(private readonly prisma: PrismaService) {}

  /** Status only — never returns plaintext, never marks revealed. */
  async getSetupStatus(userId: string): Promise<TotpSetupStatus> {
    this.assertConfigured();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { encryptedTotpSecret: true, totpSecretRevealedAt: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      configured: Boolean(user.encryptedTotpSecret),
      alreadyRevealed: Boolean(user.totpSecretRevealedAt),
    };
  }

  /**
   * One-time plaintext reveal for Authenticator enrollment.
   * Creates a random secret if missing; subsequent calls return 410.
   * Concurrent reveals are serialized with SELECT ... FOR UPDATE.
   */
  async revealSetupOnce(userId: string, email: string) {
    this.assertConfigured();

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException('User not found');
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          encryptedTotpSecret: true,
          totpSecretRevealedAt: true,
        },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.totpSecretRevealedAt) {
        throw new GoneException({
          message:
            'OTP secret은 이미 1회 표시되었습니다. 재조회할 수 없습니다.',
          code: 'TOTP_SECRET_ALREADY_REVEALED',
          configured: true,
          alreadyRevealed: true,
        });
      }

      let secret: string;
      let created = false;
      if (user.encryptedTotpSecret) {
        secret = decryptTotpSecret(user.encryptedTotpSecret);
      } else {
        secret = generateTotpSecret();
        created = true;
      }

      const revealedAt = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(created
            ? { encryptedTotpSecret: encryptTotpSecret(secret) }
            : {}),
          totpSecretRevealedAt: revealedAt,
        },
      });

      const labelEmail = email || user.email;
      return {
        secret,
        otpauthUrl: buildTotpAuthUrl(secret, labelEmail),
        created,
        alreadyRevealed: false,
        configured: true,
        hint: '이 secret은 한 번만 표시됩니다. Google Authenticator에 지금 등록하세요. (TOTP_ENCRYPTION_KEY로 암호화 저장)',
      };
    });
  }

  /** @deprecated alias — prefer revealSetupOnce */
  getOrCreateSetup(userId: string, email: string) {
    return this.revealSetupOnce(userId, email);
  }

  async verify(userId: string, token: string): Promise<boolean> {
    this.assertConfigured();
    const secret = await this.loadPlainSecret(userId);
    if (!secret) return false;
    return verifyTotpToken(secret, token);
  }

  /** Integration / test helper — never expose via HTTP. */
  async currentOtp(userId: string): Promise<string> {
    const secret = await this.loadPlainSecret(userId);
    if (!secret) {
      throw new NotFoundException('TOTP secret not provisioned');
    }
    return currentTotpToken(secret);
  }

  isConfigured(): boolean {
    return isTotpEncryptionConfigured();
  }

  private async loadPlainSecret(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { encryptedTotpSecret: true },
    });
    if (!user?.encryptedTotpSecret) return null;
    return decryptTotpSecret(user.encryptedTotpSecret);
  }

  private assertConfigured() {
    if (!isTotpEncryptionConfigured()) {
      throw new ServiceUnavailableException(
        'TOTP_ENCRYPTION_KEY is not configured',
      );
    }
  }
}
