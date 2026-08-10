import * as speakeasy from 'speakeasy';

export const TOTP_ISSUER = 'Selfmade MPC Wallet';

/** Random base32 secret for Google Authenticator. */
export function generateTotpSecret(): string {
  return speakeasy.generateSecret({ length: 20, name: TOTP_ISSUER }).base32;
}

export function buildTotpAuthUrl(secret: string, email: string): string {
  return speakeasy.otpauthURL({
    secret,
    label: email,
    issuer: TOTP_ISSUER,
    encoding: 'base32',
  });
}

export function verifyTotpToken(secret: string, token: string): boolean {
  return Boolean(
    speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1,
    }),
  );
}

export function currentTotpToken(secret: string): string {
  return speakeasy.totp({
    secret,
    encoding: 'base32',
  });
}
