import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider } from 'ethers';

/**
 * Sepolia JsonRpcProvider only — no backend private key.
 * MPC wallets pay their own gas; broadcast uses already-signed raw txs.
 */
@Injectable()
export class RpcProviderService {
  private readonly logger = new Logger(RpcProviderService.name);
  private readonly provider: JsonRpcProvider;

  constructor() {
    const rpc = process.env.SEPOLIA_RPC_URL;
    if (!rpc) {
      throw new Error('SEPOLIA_RPC_URL is missing in .env');
    }

    this.provider = new JsonRpcProvider(rpc);
    this.logger.log('Sepolia JsonRpcProvider ready (no backend signer key)');
  }

  getProvider(): JsonRpcProvider {
    return this.provider;
  }
}
