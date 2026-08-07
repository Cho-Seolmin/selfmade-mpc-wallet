import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_ENV = 'WALLET_ENCRYPTION_KEY';

function getEncryptionKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(`${KEY_ENV} is not configured`);
  }

  const trimmed = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      `${KEY_ENV} must be a 64-character hex string (32 bytes for AES-256)`,
    );
  }

  return Buffer.from(trimmed, 'hex');
}

/**
 * Encrypt Share B bytes with AES-256-GCM.
 * Stored format: base64(iv):base64(authTag):base64(ciphertext)
 */
export function encryptShareB(plaintext: Buffer | Uint8Array): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Decrypt Share B for A+B / server-side threshold signing. Never log plaintext. */
export function decryptShareB(payload: string): Buffer {
  const key = getEncryptionKey();
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted Share B payload');
  }

  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
