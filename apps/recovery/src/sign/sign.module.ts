import { Module } from '@nestjs/common';
import { SharesModule } from '../shares/shares.module';
import { SignController } from './sign.controller';
import { SignService } from './sign.service';

@Module({
  imports: [SharesModule],
  controllers: [SignController],
  providers: [SignService],
})
export class SignModule {}
