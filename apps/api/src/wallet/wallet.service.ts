import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WalletStatus } from '@prisma/client';
import {
  AuditEventType,
  type ClientReportableAuditEvent,
} from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RpcProviderService } from './rpc-provider.service';
import {
  assertWalletNotRetired,
  LIVE_WALLET_STATUSES,
} from './wallet-lifecycle';

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private rpcProvider: RpcProviderService,
    private audit: AuditService,
  ) {}

  /** Live MPC wallets only (RETIRED excluded). */
  async list(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: {
        userId,
        walletType: 'MPC',
        status: { in: LIVE_WALLET_STATUSES },
      },
      select: {
        id: true,
        walletType: true,
        status: true,
        address: true,
        mpcPublicKey: true,
        createdAt: true,
        retiredAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return wallets.map((wallet) => ({
      ...wallet,
      resolvedAddress: wallet.address,
      addressSource: 'WALLET_ROW' as const,
    }));
  }

  /**
   * Retired wallet metadata (no Share B / secrets).
   * Used so users can confirm retirement and create a new wallet.
   */
  async listRetired(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: {
        userId,
        walletType: 'MPC',
        status: WalletStatus.RETIRED,
      },
      select: {
        id: true,
        walletType: true,
        status: true,
        address: true,
        mpcPublicKey: true,
        createdAt: true,
        retiredAt: true,
      },
      orderBy: { retiredAt: 'desc' },
    });

    return wallets.map((wallet) => ({
      ...wallet,
      resolvedAddress: wallet.address,
      addressSource: 'WALLET_ROW' as const,
      /** Share B must be wiped on retire — never expose ciphertext. */
      hasEncryptedShareB: false,
    }));
  }

  async getDashboardSummary(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: {
        userId,
        walletType: 'MPC',
        status: { in: LIVE_WALLET_STATUSES },
      },
      select: { id: true },
    });

    const walletIds = wallets.map((wallet) => wallet.id);
    const pendingStatuses = [
      'PENDING',
      'APPROVED',
      'QUEUED',
      'PROCESSING',
    ] as const;

    const [
      pendingWithdrawCount,
      completedWithdrawCount,
      balances,
      retiredWalletCount,
      latestRetired,
    ] = await Promise.all([
      walletIds.length === 0
        ? 0
        : this.prisma.withdrawRequest.count({
            where: {
              walletId: { in: walletIds },
              status: { in: [...pendingStatuses] },
            },
          }),
      walletIds.length === 0
        ? 0
        : this.prisma.withdrawRequest.count({
            where: {
              walletId: { in: walletIds },
              status: 'EXECUTED',
            },
          }),
      Promise.all(
        wallets.map(async (wallet) => {
          try {
            const balance = await this.getBalance(userId, wallet.id);
            return BigInt(balance.balanceWei);
          } catch {
            return 0n;
          }
        }),
      ),
      this.prisma.wallet.count({
        where: {
          userId,
          walletType: 'MPC',
          status: WalletStatus.RETIRED,
        },
      }),
      this.prisma.wallet.findFirst({
        where: {
          userId,
          walletType: 'MPC',
          status: WalletStatus.RETIRED,
        },
        select: {
          id: true,
          address: true,
          retiredAt: true,
        },
        orderBy: { retiredAt: 'desc' },
      }),
    ]);

    const totalBalanceWei = balances.reduce((sum, wei) => sum + wei, 0n);

    return {
      walletCount: wallets.length,
      totalBalanceWei: totalBalanceWei.toString(),
      pendingWithdrawCount,
      completedWithdrawCount,
      retiredWalletCount,
      latestRetired: latestRetired
        ? {
            id: latestRetired.id,
            address: latestRetired.address,
            retiredAt: latestRetired.retiredAt,
          }
        : null,
      canCreateMpcWallet: wallets.length === 0,
    };
  }

  private async getOwnedMpcWallet(
    userId: string,
    walletId: string,
    options?: { allowRetired?: boolean },
  ) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        id: true,
        userId: true,
        walletType: true,
        status: true,
        address: true,
        mpcPublicKey: true,
        encryptedShareB: true,
        retiredAt: true,
      },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.userId !== userId) {
      throw new ForbiddenException('Not your wallet');
    }
    if (wallet.walletType !== 'MPC') {
      throw new NotFoundException('Wallet not found');
    }
    if (!options?.allowRetired) {
      assertWalletNotRetired(wallet.status, '이 작업');
    }

    return wallet;
  }

  async getBalance(userId: string, walletId: string) {
    const wallet = await this.getOwnedMpcWallet(userId, walletId);

    const balanceWei = await this.rpcProvider
      .getProvider()
      .getBalance(wallet.address);

    return {
      walletId: wallet.id,
      address: wallet.address,
      balanceWei: balanceWei.toString(),
      source: 'MPC',
      status: wallet.status,
    };
  }

  async getLimits(userId: string, walletId: string) {
    const wallet = await this.getOwnedMpcWallet(userId, walletId);

    const limit = await this.prisma.walletLimit.findUnique({
      where: { walletId: wallet.id },
    });

    return {
      walletId: wallet.id,
      dailyLimit: limit?.dailyLimit?.toString() ?? '0',
      singleTxLimit: limit?.singleTxLimit?.toString() ?? '0',
    };
  }

  /**
   * Withdraw history is allowed for RETIRED wallets (read-only audit trail).
   * Signing / emergency ops remain blocked elsewhere.
   */
  async getWithdrawHistory(
    userId: string,
    walletId: string,
    status?:
      | 'PENDING'
      | 'APPROVED'
      | 'QUEUED'
      | 'PROCESSING'
      | 'EXECUTED'
      | 'REJECTED'
      | 'FAILED'
      | 'EXPIRED',
  ) {
    const wallet = await this.getOwnedMpcWallet(userId, walletId, {
      allowRetired: true,
    });

    return this.prisma.withdrawRequest.findMany({
      where: {
        walletId: wallet.id,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        toAddress: true,
        status: true,
        approvedBy: true,
        txHash: true,
        createdAt: true,
        executionType: true,
      },
    });
  }

  /**
   * Invariant check used by tests / future ops:
   * RETIRED wallets must not retain Share B ciphertext.
   */
  async assertRetiredShareBWiped(walletId: string): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: { status: true, encryptedShareB: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.status !== WalletStatus.RETIRED) {
      throw new BadRequestException('Wallet is not RETIRED');
    }
    if (wallet.encryptedShareB) {
      throw new BadRequestException(
        'RETIRED wallet still has encryptedShareB — invariant violated',
      );
    }
  }

  /** Browser reports non-sensitive lifecycle events (Recovery File / Share restore). */
  async reportClientAuditEvent(
    userId: string,
    walletId: string,
    eventType: ClientReportableAuditEvent,
    message?: string,
    data?: Record<string, unknown>,
  ) {
    const wallet = await this.getOwnedMpcWallet(userId, walletId, {
      allowRetired: true,
    });

    const defaultMessage =
      eventType === AuditEventType.RECOVERY_FILE_CREATED
        ? 'Recovery File created and downloaded in browser'
        : 'Browser Share A restored from Recovery File';

    await this.audit.write({
      walletId: wallet.id,
      userId,
      eventType,
      message: message ?? defaultMessage,
      data: {
        ...(data ?? {}),
        reportedBy: 'browser',
      },
    });

    return { ok: true as const, eventType };
  }

  async listAuditLogs(userId: string, walletId: string, take = 50) {
    await this.getOwnedMpcWallet(userId, walletId, { allowRetired: true });
    return this.audit.listForWallet(walletId, take);
  }
}
