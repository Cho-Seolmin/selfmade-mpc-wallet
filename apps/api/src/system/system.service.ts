import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RpcProviderService } from '../wallet/rpc-provider.service';
import { WithdrawGateway } from '../wallet/withdraw.gateway';
import { isTotpEncryptionConfigured } from '../common/crypto/totp-encryption';

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private prisma: PrismaService,
    private rpcProvider: RpcProviderService,
    private withdrawGateway: WithdrawGateway,
  ) {}

  async getHealth() {
    const queuePending = await this.prisma.withdrawalQueue.count({
      where: { status: 'PENDING' },
    });

    const queueRunning = await this.prisma.withdrawalQueue.count({
      where: { status: 'RUNNING' },
    });

    const queueDead = await this.prisma.withdrawalQueue.count({
      where: { status: 'DEAD' },
    });

    return {
      queuePending,
      queueRunning,
      queueDead,
      workerActive: false,
    };
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    promise.catch(() => {});

    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms),
      ),
    ]);
  }

  async getStatus() {
    let dbConnected = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbConnected = false;
    }

    let sepoliaRpcConnected = false;
    try {
      await this.withTimeout(
        this.rpcProvider.getProvider().getBlockNumber(),
        3000,
      );
      sepoliaRpcConnected = true;
    } catch {
      sepoliaRpcConnected = false;
    }

    const websocketConnected =
      !!this.withdrawGateway.server &&
      typeof this.withdrawGateway.server.emit === 'function';

    const otpConfigured = isTotpEncryptionConfigured();

    return {
      apiStatus: 'OK',
      backendOnline: true,
      dbConnected,
      websocketConnected,
      sepoliaRpcConnected,
      otpConfigured,
      network: 'Sepolia Testnet',
      serverTime: new Date().toISOString(),
    };
  }
}
