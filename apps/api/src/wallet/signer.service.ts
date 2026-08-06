import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider, Wallet } from 'ethers';

@Injectable()
export class SignerService {
  private readonly logger = new Logger(SignerService.name);
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;

  constructor() {
    const rpc = process.env.SEPOLIA_RPC_URL;
    if (!rpc) {
      throw new Error('SEPOLIA_RPC_URL is missing in .env');
    }

    const pk = process.env.BACKEND_SIGNER_PRIVATE_KEY;
    if (!pk) {
      throw new Error('BACKEND_SIGNER_PRIVATE_KEY missing');
    }

    this.provider = new JsonRpcProvider(rpc);
    this.signer = new Wallet(pk, this.provider);
  }

  getProvider(): JsonRpcProvider {
    return this.provider;
  }

  getSigner(): Wallet {
    return this.signer;
  }

  async getSignerAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  async getSignerBalance(): Promise<bigint> {
    const address = await this.getSignerAddress();
    return this.provider.getBalance(address);
  }
}
