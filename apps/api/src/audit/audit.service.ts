import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { WriteAuditInput } from './audit.constants';

const SENSITIVE_KEY =
  /share|pin|otp|secret|private|cipher|password|token|keyshare|mnemonic|seed/i;

/**
 * Remove keys that look like secrets before persisting audit `data`.
 * Never log Share / PIN / OTP material.
 */
export function sanitizeAuditData(
  data?: Record<string, unknown> | null,
): Prisma.InputJsonValue | undefined {
  if (!data) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = sanitizeAuditData(value as Record<string, unknown>);
      if (nested) out[key] = nested;
      continue;
    }
    if (typeof value === 'string' && value.length > 500) {
      out[key] = `${value.slice(0, 64)}…[truncated ${value.length}]`;
      continue;
    }
    out[key] = value;
  }
  return out as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(input: WriteAuditInput): Promise<void> {
    try {
      await this.prisma.withdrawalAuditLog.create({
        data: {
          walletId: input.walletId,
          userId: input.userId ?? undefined,
          withdrawRequestId: input.withdrawRequestId ?? undefined,
          eventType: input.eventType,
          actorType: input.actorType ?? 'USER',
          actorId: input.actorId ?? input.userId ?? undefined,
          message: input.message,
          data: sanitizeAuditData(input.data) ?? undefined,
        },
      });
    } catch (err) {
      // Audit must not break primary flows; log failure without payload secrets.
      this.logger.error(
        `Failed to write audit event ${input.eventType} for wallet ${input.walletId}`,
      );
    }
  }

  async listForWallet(walletId: string, take = 50) {
    return this.prisma.withdrawalAuditLog.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 100),
      select: {
        id: true,
        eventType: true,
        actorType: true,
        actorId: true,
        message: true,
        data: true,
        withdrawRequestId: true,
        createdAt: true,
      },
    });
  }
}
