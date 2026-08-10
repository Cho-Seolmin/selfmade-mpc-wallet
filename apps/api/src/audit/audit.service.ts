import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { WriteAuditInput } from './audit.constants';

/**
 * Allow-list of audit `data` keys. Anything else is dropped (safer than
 * blocklisting secret-looking names).
 */
export const AUDIT_DATA_ALLOW_KEYS = new Set([
  'address',
  'toAddress',
  'amountWei',
  'txHash',
  'sessionId',
  'mode',
  'previousStatus',
  'nextStatus',
  'nextStep',
  'remainingAttempts',
  'locked',
  'error',
  'reportedBy',
  'scheme',
  'version',
  'failed',
  'ok',
  'zeroBalance',
]);

/**
 * Keep only allow-listed keys before persisting audit `data`.
 * Nested objects are filtered recursively. Never log Share / PIN / OTP material.
 */
export function sanitizeAuditData(
  data?: Record<string, unknown> | null,
): Prisma.InputJsonValue | undefined {
  if (!data) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!AUDIT_DATA_ALLOW_KEYS.has(key)) continue;
    if (value === undefined) continue;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = sanitizeAuditData(value as Record<string, unknown>);
      if (nested && Object.keys(nested as object).length > 0) {
        out[key] = nested;
      }
      continue;
    }

    if (Array.isArray(value)) {
      // Only allow flat primitive arrays (rare); drop otherwise.
      if (
        value.every(
          (v) =>
            v === null ||
            typeof v === 'string' ||
            typeof v === 'number' ||
            typeof v === 'boolean',
        )
      ) {
        out[key] = value.map((v) =>
          typeof v === 'string' && v.length > 500
            ? `${v.slice(0, 64)}…[truncated ${v.length}]`
            : v,
        );
      }
      continue;
    }

    if (typeof value === 'string' && value.length > 500) {
      out[key] = `${value.slice(0, 64)}…[truncated ${value.length}]`;
      continue;
    }

    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    }
  }

  return Object.keys(out).length > 0
    ? (out as Prisma.InputJsonValue)
    : undefined;
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
