import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Provider } from 'ethers';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';

/** Detect a normal A+B withdraw from stored metadata (no share material). */
export function isNormalAbMetadata(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  return (raw as Record<string, unknown>).mode === 'NORMAL_AB';
}

const OPEN_AB_STATUSES = ['PROCESSING', 'BROADCASTED'] as const;

export async function findOpenNormalAb(
  db: Prisma.TransactionClient,
  walletId: string,
): Promise<{
  id: string;
  status: string;
  txHash: string | null;
  metadata: unknown;
} | null> {
  const rows = await db.withdrawRequest.findMany({
    where: {
      walletId,
      status: { in: [...OPEN_AB_STATUSES] },
    },
    select: {
      id: true,
      status: true,
      txHash: true,
      metadata: true,
    },
  });
  return rows.find((row) => isNormalAbMetadata(row.metadata)) ?? null;
}

/**
 * Block new A+B / emergency while a NORMAL_AB withdraw is still in flight.
 * PROCESSING → 409 immediately.
 * BROADCASTED → one RPC receipt lookup (no poller):
 *   mined success → EXECUTED (caller may proceed)
 *   mined revert → FAILED (caller may proceed)
 *   not mined yet → 409 TRANSACTION_PENDING
 */
export async function settleOpenNormalAbOrThrow(params: {
  db: Prisma.TransactionClient;
  walletId: string;
  getReceipt: (
    txHash: string,
  ) => Promise<{ status: number | null } | null>;
}): Promise<void> {
  const open = await findOpenNormalAb(params.db, params.walletId);
  if (!open) return;

  if (open.status === 'PROCESSING') {
    throw new ConflictException({
      message:
        '이 지갑에 진행 중인 일반 출금 서명이 있습니다. 완료·취소 후 다시 시도하세요.',
      code: MpcErrorCode.SIGN_SESSION_BUSY,
    });
  }

  if (open.status !== 'BROADCASTED') return;

  if (!open.txHash) {
    await params.db.withdrawRequest.update({
      where: { id: open.id },
      data: {
        status: 'FAILED',
        failureReason: 'broadcasted without txHash',
      },
    });
    return;
  }

  let receipt: { status: number | null } | null;
  try {
    receipt = await params.getReceipt(open.txHash);
  } catch {
    throw new ConflictException({
      message:
        '이전 출금 트랜잭션 확인에 실패했습니다. 잠시 후 다시 시도하세요.',
      code: MpcErrorCode.TRANSACTION_PENDING,
    });
  }

  if (!receipt) {
    throw new ConflictException({
      message:
        '이전 출금이 아직 체인에서 확정되지 않았습니다. 확인 후 다시 시도하세요.',
      code: MpcErrorCode.TRANSACTION_PENDING,
    });
  }

  if (receipt.status === 1) {
    const now = new Date();
    await params.db.withdrawRequest.update({
      where: { id: open.id },
      data: {
        status: 'EXECUTED',
        confirmedAt: now,
        finalizedAt: now,
      },
    });
    return;
  }

  await params.db.withdrawRequest.update({
    where: { id: open.id },
    data: {
      status: 'FAILED',
      failureReason: 'on-chain transaction reverted',
    },
  });
}

export function receiptLookup(
  provider: Pick<Provider, 'getTransactionReceipt'>,
): (txHash: string) => Promise<{ status: number | null } | null> {
  return async (txHash: string) => {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return null;
    return { status: receipt.status ?? null };
  };
}
