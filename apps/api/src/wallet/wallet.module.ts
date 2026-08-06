import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { SignerService } from './signer.service';
import { WithdrawGateway } from './withdraw.gateway';

@Module({
  imports: [AuthModule],
  controllers: [WalletController],
  providers: [WalletService, SignerService, WithdrawGateway],
  exports: [SignerService, WithdrawGateway],
})
export class WalletModule {}
