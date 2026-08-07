import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  imports: [PrismaModule],
  controllers: [SharesController],
  providers: [SharesService],
})
export class SharesModule {}
