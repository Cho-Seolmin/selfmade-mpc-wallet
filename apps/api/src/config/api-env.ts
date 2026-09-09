const HEX_32 = /^[0-9a-fA-F]{64}$/;
const MIN_SECRET_BYTES = 32;

function requireNonEmpty(name: string, value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new Error(`${name} is not configured`);
  }
  return trimmed;
}

function requireMinBytes(name: string, value: string | undefined, minBytes: number): string {
  const trimmed = requireNonEmpty(name, value);
  if (Buffer.byteLength(trimmed, 'utf8') < minBytes) {
    throw new Error(`${name} must be at least ${minBytes} bytes`);
  }
  return trimmed;
}

function requireHex32Key(name: string, value: string | undefined): string {
  const trimmed = requireNonEmpty(name, value);
  if (!HEX_32.test(trimmed)) {
    throw new Error(
      `${name} must be a 64-character hex string (32 bytes for AES-256)`,
    );
  }
  return trimmed;
}

function requireHttpUrl(name: string, value: string | undefined): string {
  const trimmed = requireNonEmpty(name, value);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must be an http(s) URL`);
  }
  if (trimmed.endsWith('/')) {
    throw new Error(`${name} must not have a trailing slash`);
  }
  return trimmed;
}

/** CORS / CSRF compare target. Strips a trailing slash if present (env check is stricter). */
export function frontendOrigin(): string {
  return (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
}

/**
 * Railway (and similar PaaS) sit one hop in front of the app.
 * `trust proxy: 1` makes Express `req.ip` the client, not the proxy.
 * Local direct connections must stay untrusted — otherwise X-Forwarded-For is spoofable.
 * Override: TRUST_PROXY=1 | 0
 */
export function shouldTrustOneProxyHop(): boolean {
  const raw = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/**
 * Fail fast before listen. Unit tests do not call this (only `main.ts` bootstrap).
 */
export function assertApiEnv(): void {
  requireNonEmpty('DATABASE_URL', process.env.DATABASE_URL);
  requireMinBytes('JWT_SECRET', process.env.JWT_SECRET, MIN_SECRET_BYTES);
  const walletKey = requireHex32Key(
    'WALLET_ENCRYPTION_KEY',
    process.env.WALLET_ENCRYPTION_KEY,
  );
  const totpKey = requireHex32Key(
    'TOTP_ENCRYPTION_KEY',
    process.env.TOTP_ENCRYPTION_KEY,
  );
  if (walletKey.toLowerCase() === totpKey.toLowerCase()) {
    throw new Error(
      'WALLET_ENCRYPTION_KEY and TOTP_ENCRYPTION_KEY must be different',
    );
  }
  requireMinBytes(
    'RECOVERY_SERVICE_TOKEN',
    process.env.RECOVERY_SERVICE_TOKEN,
    MIN_SECRET_BYTES,
  );
  requireHttpUrl('RECOVERY_BASE_URL', process.env.RECOVERY_BASE_URL);
  requireHttpUrl('SEPOLIA_RPC_URL', process.env.SEPOLIA_RPC_URL);
  requireHttpUrl('FRONTEND_URL', process.env.FRONTEND_URL);
}
