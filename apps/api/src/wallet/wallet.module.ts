import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DkgOrchestratorService } from '../mpc/dkg-orchestrator.service';
import { RecoveryClientService } from '../mpc/recovery-client.service';
import { SignOrchestratorService } from '../mpc/sign-orchestrator.service';
import { EmergencyLastWithdrawService } from './emergency-last-withdraw.service';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { SignerService } from './signer.service';
import { WithdrawGateway } from './withdraw.gateway';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    SignerService,
    WithdrawGateway,
    RecoveryClientService,
    DkgOrchestratorService,
    SignOrchestratorService,
    EmergencyRecoveryService,
    EmergencyLastWithdrawService,
  ],
  exports: [SignerService, WithdrawGateway],
})
export class WalletModule {}
