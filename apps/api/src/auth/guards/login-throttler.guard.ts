import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * IP tracker for login. Uses Express `req.ip`.
 * Production sets `trust proxy: 1` so this is the client, not the Railway hop.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: { ip?: string }): Promise<string> {
    return Promise.resolve(`login:${req.ip ?? 'unknown'}`);
  }
}
