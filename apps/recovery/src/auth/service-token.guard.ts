import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Simple service-to-service auth between Main API and Recovery Server.
 * Not end-user JWT — Recovery is never called directly from the browser.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.RECOVERY_SERVICE_TOKEN?.trim();
    if (!expected) {
      throw new UnauthorizedException('RECOVERY_SERVICE_TOKEN is not configured');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = header.slice('Bearer '.length).trim();
    if (token !== expected) {
      throw new UnauthorizedException('Invalid service token');
    }

    return true;
  }
}
