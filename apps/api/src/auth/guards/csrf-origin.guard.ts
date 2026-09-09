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

function cookiePresent(req: Request): boolean {
  const token = req.cookies?.[ACCESS_COOKIE];
  return typeof token === 'string' && token.length > 0;
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
 * Cookie-authenticated CSRF defense for cross-site (SameSite=None) deploys.
 * CORS allowlists who can *read* responses; this checks Origin/Referer on
 * state-changing requests that actually send the access cookie.
 * Bearer-only requests are not CSRF (the browser will not attach that header).
 */
@Injectable()
export class CsrfOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!isUnsafeMethod(req) || !cookiePresent(req)) {
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
