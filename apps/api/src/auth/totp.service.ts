import {
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

@Injectable()
export class TotpService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensure the user has a stored random TOTP secret; return plaintext for QR setup.
   * Secret is encrypted at rest with TOTP_ENCRYPTION_KEY.
   */
  async getOrCreateSetup(userId: string, email: string) {
    this.assertConfigured();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, encryptedTotpSecret: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    let secret: string;
    let created = false;
    if (user.encryptedTotpSecret) {
      secret = decryptTotpSecret(user.encryptedTotpSecret);
    } else {
      secret = generateTotpSecret();
      await this.prisma.user.update({
        where: { id: userId },
        data: { encryptedTotpSecret: encryptTotpSecret(secret) },
      });
      created = true;
    }

    const labelEmail = email || user.email;
    return {
      secret,
      otpauthUrl: buildTotpAuthUrl(secret, labelEmail),
      created,
      hint: 'Google Authenticator 등에 아래 secret 또는 otpauth URL을 등록하세요. JWT와 별도 키(TOTP_ENCRYPTION_KEY)로 암호화 저장됩니다.',
    };
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
