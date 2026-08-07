import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DkgController } from './dkg.controller';
import { DkgService } from './dkg.service';

@Module({
  imports: [PrismaModule],
  controllers: [DkgController],
  providers: [DkgService],
})
export class DkgModule {}
