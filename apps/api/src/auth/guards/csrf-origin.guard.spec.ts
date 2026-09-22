import { ForbiddenException } from '@nestjs/common';
import { CsrfOriginGuard } from './csrf-origin.guard';

function ctx(req: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as any;
}

describe('CsrfOriginGuard', () => {
  const guard = new CsrfOriginGuard();
  const previous = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'http://localhost:5173';
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous;
  });

  it('allows GET without cookies', () => {
    expect(
      guard.canActivate(
        ctx({ method: 'GET', url: '/wallets', cookies: {} }),
      ),
    ).toBe(true);
  });

  it('allows login POST from FRONTEND_URL without an access cookie', () => {
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          url: '/auth/login',
          cookies: {},
          headers: { origin: 'http://localhost:5173' },
        }),
      ),
    ).toBe(true);
  });

  it('allows login POST when only Referer matches FRONTEND_URL', () => {
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          url: '/auth/login',
          cookies: {},
          headers: { referer: 'http://localhost:5173/login' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects login POST from another origin without an access cookie', () => {
    expect(() =>
      guard.canActivate(
        ctx({
          method: 'POST',
          url: '/auth/login',
          cookies: {},
          headers: { origin: 'https://evil.example' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects login POST with neither Origin nor Referer', () => {
    expect(() =>
      guard.canActivate(
        ctx({
          method: 'POST',
          url: '/auth/login',
          cookies: {},
          headers: {},
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('still allows register POST without an access cookie or Origin', () => {
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          url: '/auth/register',
          cookies: {},
          headers: {},
        }),
      ),
    ).toBe(true);
  });

  it('rejects cookie POST from another origin', () => {
    expect(() =>
      guard.canActivate(
        ctx({
          method: 'POST',
          url: '/wallets/mpc/dkg/start',
          cookies: { accessToken: 'jwt' },
          headers: { origin: 'https://evil.example' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows cookie POST from FRONTEND_URL', () => {
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          url: '/wallets/mpc/dkg/start',
          cookies: { accessToken: 'jwt' },
          headers: { origin: 'http://localhost:5173' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects cookie POST to totp-setup from another origin', () => {
    expect(() =>
      guard.canActivate(
        ctx({
          method: 'POST',
          url: '/auth/totp-setup',
          cookies: { accessToken: 'jwt' },
          headers: { origin: 'https://evil.example' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
