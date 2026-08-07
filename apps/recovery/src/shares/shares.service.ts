import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { decryptShareC, encryptShareC } from '../crypto/share-c-encryption';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertShareCDto } from './dto/upsert-share-c.dto';

/** DKLs party id for Share C in the 2-of-3 scheme (A=0, B=1, C=2). */
const SHARE_C_PARTY_ID = 2;

const STATUS_ACTIVE = 'ACTIVE';
const STATUS_RETIRED = 'RETIRED';

@Injectable()
export class SharesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Store encrypted Share C after DKG.
   * Rejects overwrite of an ACTIVE share (idempotent only for identical wallet).
   */
  async upsertShareC(dto: UpsertShareCDto) {
    const partyId = dto.partyId ?? SHARE_C_PARTY_ID;
    if (partyId !== SHARE_C_PARTY_ID) {
      throw new ConflictException('Recovery Server only stores Share C (partyId=2)');
    }

    const existing = await this.prisma.mpcRecoveryShare.findUnique({
      where: { walletId: dto.walletId },
    });

    if (existing && existing.status === STATUS_ACTIVE) {
      throw new ConflictException('Active Share C already exists for this wallet');
    }

    let shareBytes: Buffer;
    try {
      shareBytes = Buffer.from(dto.shareCBase64, 'base64');
    } catch {
      throw new ConflictException('shareCBase64 is not valid base64');
    }
    if (shareBytes.length < 32) {
      throw new ConflictException('Share C payload too short');
    }

    const encryptedShareC = encryptShareC(shareBytes);

    const row = existing
      ? await this.prisma.mpcRecoveryShare.update({
          where: { walletId: dto.walletId },
          data: {
            userId: dto.userId,
            partyId,
            mpcPublicKey: dto.mpcPublicKey,
            encryptedShareC,
            status: STATUS_ACTIVE,
            retiredAt: null,
          },
        })
      : await this.prisma.mpcRecoveryShare.create({
          data: {
            walletId: dto.walletId,
            userId: dto.userId,
            partyId,
            mpcPublicKey: dto.mpcPublicKey,
            encryptedShareC,
            status: STATUS_ACTIVE,
          },
        });

    return this.toSafeDto(row);
  }

  /** Metadata only — never returns plaintext or ciphertext Share C. */
  async getShareMeta(walletId: string) {
    const row = await this.requireShare(walletId);
    return this.toSafeDto(row);
  }

  /**
   * Decrypt Share C for emergency B+C signing (internal Main API only).
   * Response must never be logged.
   */
  async exportShareCForSigning(walletId: string) {
    const row = await this.requireShare(walletId);
    if (row.status !== STATUS_ACTIVE) {
      throw new ConflictException('Share C is not ACTIVE');
    }

    const shareBytes = decryptShareC(row.encryptedShareC);

    return {
      walletId: row.walletId,
      userId: row.userId,
      partyId: row.partyId,
      mpcPublicKey: row.mpcPublicKey,
      status: row.status,
      /** Base64 Share C plaintext — TLS + service token only. */
      shareCBase64: shareBytes.toString('base64'),
    };
  }

  async retireShare(walletId: string) {
    const row = await this.requireShare(walletId);
    if (row.status === STATUS_RETIRED) {
      return this.toSafeDto(row);
    }

    const updated = await this.prisma.mpcRecoveryShare.update({
      where: { walletId },
      data: {
        status: STATUS_RETIRED,
        retiredAt: new Date(),
        // Wipe ciphertext so retired wallets cannot be revived from Recovery DB alone.
        encryptedShareC: '',
      },
    });

    return this.toSafeDto(updated);
  }

  private async requireShare(walletId: string) {
    const row = await this.prisma.mpcRecoveryShare.findUnique({
      where: { walletId },
    });
    if (!row) {
      throw new NotFoundException('Share C not found');
    }
    return row;
  }

  private toSafeDto(row: {
    id: string;
    walletId: string;
    userId: string;
    partyId: number;
    mpcPublicKey: string;
    status: string;
    createdAt: Date;
    retiredAt: Date | null;
  }) {
    return {
      id: row.id,
      walletId: row.walletId,
      userId: row.userId,
      partyId: row.partyId,
      mpcPublicKey: row.mpcPublicKey,
      status: row.status,
      createdAt: row.createdAt,
      retiredAt: row.retiredAt,
      hasEncryptedShare: row.status === STATUS_ACTIVE,
    };
  }
}
