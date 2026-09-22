import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { frontendOrigin } from '../../config/api-env';
import { ACCESS_COOKIE } from '../cookie.util';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOGIN_PATH = '/auth/login';

function cookiePresent(req: Request): boolean {
  const token = req.cookies?.[ACCESS_COOKIE];
  return typeof token === 'string' && token.length > 0;
}

function requestPathname(req: Request): string {
  const raw =
    (typeof req.path === 'string' && req.path !== '' ? req.path : null) ??
    (typeof req.url === 'string' ? req.url : '');
  const pathname = raw.split('?')[0] ?? '';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function isLoginPost(req: Request): boolean {
  return req.method.toUpperCase() === 'POST' && requestPathname(req) === LOGIN_PATH;
}

function headerOrigin(req: Request): string | null {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.trim()) {
    return origin.trim().replace(/\/$/, '');
  }

  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.trim()) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  return null;
}

function isUnsafeMethod(req: Request): boolean {
  return UNSAFE_METHODS.has(req.method.toUpperCase());
}

/**
 * CSRF defense for cross-site (SameSite=None) deploys.
 * CORS allowlists who can *read* responses; this checks Origin/Referer on
 * state-changing requests that send the access cookie, and on POST /auth/login
 * even when no cookie is present yet (login CSRF).
 * Bearer-only requests are not CSRF (the browser will not attach that header).
 */
@Injectable()
export class CsrfOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!isUnsafeMethod(req)) {
      return true;
    }
    if (!cookiePresent(req) && !isLoginPost(req)) {
      return true;
    }

    const expected = frontendOrigin();
    const origin = headerOrigin(req);
    if (origin !== expected) {
      throw new ForbiddenException('CSRF origin mismatch');
    }
    return true;
  }
}
