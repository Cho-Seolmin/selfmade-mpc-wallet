import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { TotpService } from './totp.service';
import type { StringValue } from 'ms';

const expiresIn = (process.env.JWT_EXPIRES_IN ?? '7d') as StringValue;

@Module({
  imports: [
    PassportModule,
    ThrottlerModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET!,
      signOptions: { expiresIn },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LoginThrottlerGuard, TotpService],
  exports: [AuthService, JwtModule, TotpService],
})
export class AuthModule {}
