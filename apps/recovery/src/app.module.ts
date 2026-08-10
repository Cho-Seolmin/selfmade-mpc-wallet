import { Module } from '@nestjs/common';
import { DkgModule } from './dkg/dkg.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { SharesModule } from './shares/shares.module';
import { SignModule } from './sign/sign.module';

@Module({
  imports: [PrismaModule, HealthModule, SharesModule, DkgModule, SignModule],
})
export class AppModule {}
