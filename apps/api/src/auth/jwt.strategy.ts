import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

function extractAccessToken(req: Request): string | null {
  const cookieToken = req.cookies?.accessToken;
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }

  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractAccessToken]),
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: {
    sub?: string;
    email?: string;
    role?: string;
    type?: string;
    tokenVersion?: number;
  }) {
    if (payload?.type === 'verify-email') {
      throw new UnauthorizedException(
        'This token cannot be used for authentication',
      );
    }

    if (payload?.type && payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        tokenVersion: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is not active');
    }

    const tokenVersion =
      typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 0;
    if (tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Session expired');
    }

    return { sub: user.id, email: user.email, role: user.role };
  }
}
