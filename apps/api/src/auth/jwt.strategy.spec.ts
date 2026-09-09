import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };
  const previousJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = previousJwtSecret ?? 'test-jwt-secret';
    prisma = { user: { findUnique: jest.fn() } };
    strategy = new JwtStrategy(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousJwtSecret;
    }
  });

  it('rejects verify-email tokens', async () => {
    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'a@b.com',
        type: 'verify-email',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects non-access token types', async () => {
    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'a@b.com',
        type: 'refresh',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts access tokens for active users', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      role: 'USER',
      status: 'ACTIVE',
      tokenVersion: 0,
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'a@b.com',
        type: 'access',
      }),
    ).resolves.toEqual({
      sub: 'user-1',
      email: 'a@b.com',
      role: 'USER',
    });
  });

  it('rejects access tokens after password change (tokenVersion mismatch)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      role: 'USER',
      status: 'ACTIVE',
      tokenVersion: 2,
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'a@b.com',
        type: 'access',
        tokenVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
