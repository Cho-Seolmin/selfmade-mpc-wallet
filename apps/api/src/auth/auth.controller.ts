import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Patch,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { ChangePasswordDto } from './dto/change-password.dto';
import { TotpService } from './totp.service';
import {
  ACCESS_COOKIE,
  getAccessCookieOptions,
  getClearAccessCookieOptions,
} from './cookie.util';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly totp: TotpService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password);
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    return this.auth.verifyEmail(token);
  }

  @Post('login')
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken } = await this.auth.login(dto.email, dto.password);

    res.cookie(ACCESS_COOKIE, accessToken, getAccessCookieOptions());

    return { ok: true };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_COOKIE, getClearAccessCookieOptions());
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req: any) {
    return this.auth.getMe(req.user.sub);
  }

  @Get('totp-status')
  @UseGuards(JwtAuthGuard)
  getTotpStatus(@Req() req: any) {
    return this.totp.getSetupStatus(req.user.sub as string);
  }

  /** One-time plaintext OTP secret reveal (subsequent calls → 410). */
  @Get('totp-setup')
  @UseGuards(JwtAuthGuard)
  getTotpSetup(@Req() req: any) {
    const userId = req.user.sub as string;
    const email = req.user.email as string;
    return this.totp.revealSetupOnce(userId, email);
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(
      req.user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
