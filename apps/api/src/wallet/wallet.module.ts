import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DkgOrchestratorService } from '../mpc/dkg-orchestrator.service';
import { RecoveryClientService } from '../mpc/recovery-client.service';
import { SignOrchestratorService } from '../mpc/sign-orchestrator.service';
import { EmergencyLastWithdrawService } from './emergency-last-withdraw.service';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { RpcProviderService } from './rpc-provider.service';
import { WithdrawGateway } from './withdraw.gateway';

@Module({
  imports: [AuthModule, AuditModule, ThrottlerModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    RpcProviderService,
    WithdrawGateway,
    RecoveryClientService,
    DkgOrchestratorService,
    SignOrchestratorService,
    EmergencyRecoveryService,
    EmergencyLastWithdrawService,
  ],
  exports: [RpcProviderService, WithdrawGateway],
})
export class WalletModule {}
