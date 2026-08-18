import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';

export const EMERGENCY_BC_MODE = 'EMERGENCY_BC_RELAY';

/** Live PROCESSING without txHash is treated as in-flight; older rows are stale crashes. */
export const STALE_EMERGENCY_PROCESSING_MS = 2 * 60 * 1000;

const OPEN_EMERGENCY_STATUSES = ['PROCESSING', 'BROADCASTED'] as const;

export type EmergencyBcAsset = 'ETH' | 'ERC20';

export type EmergencyBcMetadata = {
  mode: typeof EMERGENCY_BC_MODE;
  asset: EmergencyBcAsset;
  tokenAddress?: string;
  tokenAmount?: string;
  feeWei?: string;
  balanceWei?: string;
  zeroBalance?: boolean;
  skipped?: string;
  signedRaw?: string;
  tx?: Record<string, unknown>;
};

export type OpenEmergencyRow = {
  id: string;
  status: string;
  txHash: string | null;
  amount: string;
  toAddress: string;
  createdAt: Date;
  metadata: unknown;
};

export function asEmergencyBcMetadata(
  raw: unknown,
): EmergencyBcMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.mode !== EMERGENCY_BC_MODE) return null;
  if (rec.asset !== 'ETH' && rec.asset !== 'ERC20') return null;
  return rec as EmergencyBcMetadata;
}

function isEmergencyBcMetadata(raw: unknown): boolean {
  return asEmergencyBcMetadata(raw) !== null;
}

export function signedRawFromMetadata(raw: unknown): string | null {
  const meta = asEmergencyBcMetadata(raw);
  const value = meta?.signedRaw;
  return typeof value === 'string' && value.startsWith('0x') ? value : null;
}

export async function findOpenEmergencyBc(
  db: Prisma.TransactionClient,
  walletId: string,
): Promise<OpenEmergencyRow[]> {
  const rows = await db.withdrawRequest.findMany({
    where: {
      walletId,
      status: { in: [...OPEN_EMERGENCY_STATUSES] },
    },
    select: {
      id: true,
      status: true,
      txHash: true,
      amount: true,
      toAddress: true,
      createdAt: true,
      metadata: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const emergency = rows.filter((row) => isEmergencyBcMetadata(row.metadata));
  emergency.sort((a, b) => {
    const assetA = asEmergencyBcMetadata(a.metadata)?.asset;
    const assetB = asEmergencyBcMetadata(b.metadata)?.asset;
    if (assetA === assetB) return 0;
    if (assetA === 'ERC20') return -1;
    if (assetB === 'ERC20') return 1;
    return 0;
  });
  return emergency;
}

export async function findLatestEmergencyBc(
  db: Pick<Prisma.TransactionClient, 'withdrawRequest'>,
  walletId: string,
  asset: EmergencyBcAsset,
): Promise<OpenEmergencyRow | null> {
  const rows = await db.withdrawRequest.findMany({
    where: { walletId },
    select: {
      id: true,
      status: true,
      txHash: true,
      amount: true,
      toAddress: true,
      createdAt: true,
      metadata: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return (
    rows.find((row) => asEmergencyBcMetadata(row.metadata)?.asset === asset) ??
    null
  );
}

export type EmergencySettleOutcome =
  | { action: 'clear' }
  | {
      action: 'rebroadcast';
      id: string;
      txHash: string;
      signedRaw: string;
    };

/**
 * Settle in-flight emergency B+C rows (no poller).
 * PROCESSING without txHash:
 *   fresh → 409 (another request may still be signing)
 *   stale → FAILED (crash before persist-before-RPC, so no broadcast)
 * BROADCASTED:
 *   receipt success → EXECUTED
 *   receipt revert → FAILED
 *   no receipt → caller rebroadcasts the stored signed raw, then 409
 */
export async function settleOpenEmergencyBcOrThrow(params: {
  db: Prisma.TransactionClient;
  walletId: string;
  getReceipt: (
    txHash: string,
  ) => Promise<{ status: number | null } | null>;
  now?: Date;
}): Promise<EmergencySettleOutcome> {
  const now = params.now ?? new Date();
  const open = await findOpenEmergencyBc(params.db, params.walletId);

  for (const row of open) {
    if (row.status === 'PROCESSING') {
      if (row.txHash) {
        throw new ConflictException({
          message:
            '이전 비상 출금이 아직 체인에서 확정되지 않았습니다. 확인 후 다시 시도하세요.',
          code: MpcErrorCode.TRANSACTION_PENDING,
        });
      }
      const ageMs = now.getTime() - row.createdAt.getTime();
      if (ageMs < STALE_EMERGENCY_PROCESSING_MS) {
        throw new ConflictException({
          message:
            '이 지갑에 진행 중인 비상 출금 서명이 있습니다. 잠시 후 다시 시도하세요.',
          code: MpcErrorCode.SIGN_SESSION_BUSY,
        });
      }
      await params.db.withdrawRequest.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          failureReason: 'stale processing without broadcast',
        },
      });
      continue;
    }

    if (row.status !== 'BROADCASTED') continue;

    if (!row.txHash) {
      await params.db.withdrawRequest.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          failureReason: 'broadcasted without txHash',
        },
      });
      continue;
    }

    let receipt: { status: number | null } | null;
    try {
      receipt = await params.getReceipt(row.txHash);
    } catch {
      throw new ConflictException({
        message:
          '이전 비상 출금 트랜잭션 확인에 실패했습니다. 잠시 후 다시 시도하세요.',
        code: MpcErrorCode.TRANSACTION_PENDING,
      });
    }

    if (!receipt) {
      const signedRaw = signedRawFromMetadata(row.metadata);
      if (!signedRaw) {
        throw new ConflictException({
          message:
            '이전 비상 출금이 아직 체인에서 확정되지 않았습니다. 확인 후 다시 시도하세요.',
          code: MpcErrorCode.TRANSACTION_PENDING,
        });
      }
      return {
        action: 'rebroadcast',
        id: row.id,
        txHash: row.txHash,
        signedRaw,
      };
    }

    if (receipt.status === 1) {
      await params.db.withdrawRequest.update({
        where: { id: row.id },
        data: {
          status: 'EXECUTED',
          confirmedAt: now,
          finalizedAt: now,
        },
      });
      continue;
    }

    await params.db.withdrawRequest.update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        failureReason: 'on-chain transaction reverted',
      },
    });
  }

  return { action: 'clear' };
}

export function transactionPendingException(): ConflictException {
  return new ConflictException({
    message:
      '비상 출금 트랜잭션이 아직 체인에서 확정되지 않았습니다. 확인 후 다시 시도하세요. 지갑은 폐기되지 않았습니다.',
    code: MpcErrorCode.TRANSACTION_PENDING,
  });
}
