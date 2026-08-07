import { randomBytes } from 'crypto';
import { decryptShareC, encryptShareC } from './share-c-encryption';

describe('Share C encryption', () => {
  const previous = process.env.RECOVERY_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.RECOVERY_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });

  afterAll(() => {
    if (previous === undefined) {
      delete process.env.RECOVERY_ENCRYPTION_KEY;
    } else {
      process.env.RECOVERY_ENCRYPTION_KEY = previous;
    }
  });

  it('round-trips Share C bytes', () => {
    const share = randomBytes(128);
    const encrypted = encryptShareC(share);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(encrypted).not.toContain(share.toString('base64'));

    const decrypted = decryptShareC(encrypted);
    expect(Buffer.compare(decrypted, share)).toBe(0);
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptShareC(randomBytes(32));
    const [iv, tag, data] = encrypted.split(':');
    const tampered = Buffer.from(data, 'base64');
    tampered[0] ^= 0xff;
    const bad = `${iv}:${tag}:${tampered.toString('base64')}`;
    expect(() => decryptShareC(bad)).toThrow();
  });

  it('does not use a random IV collision format with plaintext key material in output', () => {
    const a = encryptShareC(Buffer.from('same-share-material-for-iv-test'));
    const b = encryptShareC(Buffer.from('same-share-material-for-iv-test'));
    expect(a).not.toEqual(b);
  });
});
