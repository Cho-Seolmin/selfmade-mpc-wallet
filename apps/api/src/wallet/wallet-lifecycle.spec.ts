import { BadRequestException } from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import {
  assertWalletNotRetired,
  isLiveWalletStatus,
  isRetiredWalletStatus,
  LIVE_WALLET_STATUSES,
} from './wallet-lifecycle';

describe('wallet-lifecycle', () => {
  it('treats ACTIVE / RECOVERY_PENDING / RETIRING as live', () => {
    expect(isLiveWalletStatus(WalletStatus.ACTIVE)).toBe(true);
    expect(isLiveWalletStatus(WalletStatus.RECOVERY_PENDING)).toBe(true);
    expect(isLiveWalletStatus(WalletStatus.RETIRING)).toBe(true);
    expect(isLiveWalletStatus(WalletStatus.RETIRED)).toBe(false);
    expect(LIVE_WALLET_STATUSES).not.toContain(WalletStatus.RETIRED);
  });

  it('detects RETIRED', () => {
    expect(isRetiredWalletStatus(WalletStatus.RETIRED)).toBe(true);
    expect(isRetiredWalletStatus(WalletStatus.ACTIVE)).toBe(false);
  });

  it('assertWalletNotRetired blocks RETIRED only', () => {
    expect(() => assertWalletNotRetired(WalletStatus.ACTIVE)).not.toThrow();
    expect(() => assertWalletNotRetired(WalletStatus.RETIRED, '잔액 조회')).toThrow(
      BadRequestException,
    );
    try {
      assertWalletNotRetired(WalletStatus.RETIRED, '잔액 조회');
    } catch (err: any) {
      expect(err.getResponse()).toEqual(
        expect.objectContaining({
          code: 'WALLET_RETIRED',
          message: expect.stringMatching(/잔액 조회/),
        }),
      );
    }
  });
});
