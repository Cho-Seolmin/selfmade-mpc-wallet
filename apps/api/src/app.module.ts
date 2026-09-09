import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CsrfOriginGuard } from './auth/guards/csrf-origin.guard';
import { WalletModule } from './wallet/wallet.module';
import { SystemModule } from './system/system.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    AuditModule,
    AuthModule,
    WalletModule,
    SystemModule,
    SettingsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: CsrfOriginGuard }],
})
export class AppModule {}
