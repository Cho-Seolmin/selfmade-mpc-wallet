import { BadRequestException } from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';

/** Wallets still in the lifecycle (excludes RETIRED). */
export const LIVE_WALLET_STATUSES: WalletStatus[] = [
  WalletStatus.ACTIVE,
  WalletStatus.RECOVERY_PENDING,
  WalletStatus.RETIRING,
];

export function isLiveWalletStatus(status: WalletStatus): boolean {
  return LIVE_WALLET_STATUSES.includes(status);
}

export function isRetiredWalletStatus(status: WalletStatus): boolean {
  return status === WalletStatus.RETIRED;
}

/**
 * Reject operations that must never run on a RETIRED wallet
 * (signing, emergency start, balance as "active wallet", etc.).
 */
export function assertWalletNotRetired(
  status: WalletStatus,
  action = '이 작업',
): void {
  if (status === WalletStatus.RETIRED) {
    throw new BadRequestException({
      message: `${action}을(를) 할 수 없습니다. 이미 폐기(RETIRED)된 지갑입니다.`,
      code: MpcErrorCode.WALLET_RETIRED,
    });
  }
}

/** Require an operable live wallet (not RETIRED). */
export function assertLiveWallet(
  status: WalletStatus,
  action = '이 작업',
): void {
  assertWalletNotRetired(status, action);
}
