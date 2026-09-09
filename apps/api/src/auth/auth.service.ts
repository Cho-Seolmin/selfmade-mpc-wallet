import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';

type VerifyPayload = { sub: string; email: string; type: 'verify-email' };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string) {
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new BadRequestException('Email already in use');

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'USER',
        status: 'PENDING',
      },
      select: {
        id: true,
        email: true,
        status: true,
        role: true,
        createdAt: true,
      },
    });

    // 이메일 발송은 나중에 — 지금은 토큰을 반환(데모/개발 편의)
    const token = this.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        type: 'verify-email',
      } satisfies VerifyPayload,
      { expiresIn: '1d' },
    );

    return {
      user,
      verifyUrl: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/auth/verify-email?token=${token}`,
      token,
    };
  }

  async verifyEmail(token: string) {
    let payload: VerifyPayload;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new BadRequestException('Invalid or expired token');
    }

    if (payload.type !== 'verify-email')
      throw new BadRequestException('Invalid token type');

    const user = await this.prisma.user.update({
      where: { id: payload.sub },
      data: { status: 'ACTIVE' },
      select: { id: true, email: true, status: true, role: true },
    });

    return { ok: true, user };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'ACTIVE')
      throw new UnauthorizedException('Email not verified');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
      tokenVersion: user.tokenVersion,
    });

    return { accessToken };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('새 비밀번호는 8자 이상이어야 합니다.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('사용자를 찾을 수 없습니다.');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok)
      throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다.');

    const isSameAsCurrent = await bcrypt.compare(
      newPassword,
      user.passwordHash,
    );
    if (isSameAsCurrent) {
      throw new BadRequestException(
        '새 비밀번호는 현재 비밀번호와 달라야 합니다.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
      },
      select: {
        id: true,
        email: true,
        role: true,
        tokenVersion: true,
      },
    });

    const accessToken = this.jwt.sign({
      sub: updated.id,
      email: updated.email,
      role: updated.role,
      type: 'access',
      tokenVersion: updated.tokenVersion,
    });

    return {
      ok: true,
      message: '비밀번호가 변경되었습니다.',
      accessToken,
    };
  }

  async getMe(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupExpiredPendingUsers() {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const result = await this.prisma.user.deleteMany({
      where: {
        status: 'PENDING',
        createdAt: {
          lt: tenMinutesAgo,
        },
      },
    });

    if (result.count > 0) {
      console.log(`Deleted expired pending users: ${result.count}`);
    }
  }
}
