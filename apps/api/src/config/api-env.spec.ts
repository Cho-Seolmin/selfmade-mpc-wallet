import { assertApiEnv, frontendOrigin, shouldTrustOneProxyHop } from './api-env';

function hex32(seed: string): string {
  return Buffer.from(seed.padEnd(32, '0')).toString('hex');
}

describe('assertApiEnv', () => {
  const previous = { ...process.env };

  afterEach(() => {
    process.env = { ...previous };
  });

  function fillValid() {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.JWT_SECRET = 'j'.repeat(32);
    process.env.WALLET_ENCRYPTION_KEY = hex32('wallet-key');
    process.env.TOTP_ENCRYPTION_KEY = hex32('totp-key');
    process.env.RECOVERY_SERVICE_TOKEN = 'r'.repeat(32);
    process.env.RECOVERY_BASE_URL = 'http://localhost:3001';
    process.env.SEPOLIA_RPC_URL = 'https://example.invalid/rpc';
    process.env.FRONTEND_URL = 'http://localhost:5173';
  }

  it('accepts a complete env', () => {
    fillValid();
    expect(() => assertApiEnv()).not.toThrow();
  });

  it('rejects a missing JWT_SECRET', () => {
    fillValid();
    delete process.env.JWT_SECRET;
    expect(() => assertApiEnv()).toThrow(/JWT_SECRET/);
  });

  it('rejects identical WALLET and TOTP encryption keys', () => {
    fillValid();
    const same = hex32('shared-key');
    process.env.WALLET_ENCRYPTION_KEY = same;
    process.env.TOTP_ENCRYPTION_KEY = same;
    expect(() => assertApiEnv()).toThrow(/must be different/);
  });

  it('rejects a short JWT_SECRET', () => {
    fillValid();
    process.env.JWT_SECRET = 'too-short';
    expect(() => assertApiEnv()).toThrow(/JWT_SECRET/);
  });

  it('rejects a short RECOVERY_SERVICE_TOKEN', () => {
    fillValid();
    process.env.RECOVERY_SERVICE_TOKEN = 'short-token';
    expect(() => assertApiEnv()).toThrow(/RECOVERY_SERVICE_TOKEN/);
  });

  it('rejects FRONTEND_URL with a trailing slash', () => {
    fillValid();
    process.env.FRONTEND_URL = 'https://app.example/';
    expect(() => assertApiEnv()).toThrow(/trailing slash/);
  });
});

describe('frontendOrigin', () => {
  const previous = process.env.FRONTEND_URL;

  afterEach(() => {
    if (previous === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous;
  });

  it('strips a trailing slash', () => {
    process.env.FRONTEND_URL = 'https://app.example/';
    expect(frontendOrigin()).toBe('https://app.example');
  });
});

describe('shouldTrustOneProxyHop', () => {
  const previousNode = process.env.NODE_ENV;
  const previousTrust = process.env.TRUST_PROXY;

  afterEach(() => {
    if (previousNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNode;
    if (previousTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrust;
  });

  it('is off locally unless TRUST_PROXY is set', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TRUST_PROXY;
    expect(shouldTrustOneProxyHop()).toBe(false);
  });

  it('is on in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TRUST_PROXY;
    expect(shouldTrustOneProxyHop()).toBe(true);
  });

  it('can be forced off in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUST_PROXY = '0';
    expect(shouldTrustOneProxyHop()).toBe(false);
  });
});
