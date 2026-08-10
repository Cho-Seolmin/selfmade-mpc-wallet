import { randomBytes } from 'crypto';
import {
  decryptTotpSecret,
  encryptTotpSecret,
} from './totp-encryption';
import {
  currentTotpToken,
  generateTotpSecret,
  verifyTotpToken,
} from '../../auth/totp.util';

describe('TOTP encryption + random secret', () => {
  beforeAll(() => {
    process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });

  it('round-trips encrypted secret', () => {
    const secret = generateTotpSecret();
    const enc = encryptTotpSecret(secret);
    expect(enc).not.toContain(secret);
    expect(decryptTotpSecret(enc)).toBe(secret);
  });

  it('verifies current token for generated secret', () => {
    const secret = generateTotpSecret();
    const token = currentTotpToken(secret);
    expect(verifyTotpToken(secret, token)).toBe(true);
    expect(verifyTotpToken(secret, '000000')).toBe(false);
  });
});
