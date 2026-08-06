import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SignerService } from './signer.service';

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private signerService: SignerService,
  ) {}

  async list(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, walletType: 'MPC' },
      select: {
        id: true,
        walletType: true,
        address: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return wallets.map((wallet) => ({
      ...wallet,
      resolvedAddress: wallet.address,
      addressSource: 'WALLET_ROW' as const,
    }));
  }

  async getDashboardSummary(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, walletType: 'MPC' },
      select: { id: true },
    });

    const walletIds = wallets.map((wallet) => wallet.id);
    const pendingStatuses = [
      'PENDING',
      'APPROVED',
      'QUEUED',
      'PROCESSING',
    ] as const;

    const [pendingWithdrawCount, completedWithdrawCount, balances] =
      await Promise.all([
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
      ]);

    const totalBalanceWei = balances.reduce((sum, wei) => sum + wei, 0n);

    return {
      walletCount: wallets.length,
      totalBalanceWei: totalBalanceWei.toString(),
      pendingWithdrawCount,
      completedWithdrawCount,
    };
  }

  private async getOwnedMpcWallet(userId: string, walletId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        id: true,
        userId: true,
        walletType: true,
        address: true,
      },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.userId !== userId) {
      throw new ForbiddenException('Not your wallet');
    }
    if (wallet.walletType !== 'MPC') {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }

  async getBalance(userId: string, walletId: string) {
    const wallet = await this.getOwnedMpcWallet(userId, walletId);

    const balanceWei = await this.signerService
      .getProvider()
      .getBalance(wallet.address);

    return {
      walletId: wallet.id,
      address: wallet.address,
      balanceWei: balanceWei.toString(),
      source: 'MPC',
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
    const wallet = await this.getOwnedMpcWallet(userId, walletId);

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
}
