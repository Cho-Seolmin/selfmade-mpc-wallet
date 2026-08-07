import { computeAddress, hexlify, Signature, SigningKey } from 'ethers';
import type { MpcEcdsaSignature } from './types';

/** Derive a checksummed Ethereum address from a compressed/uncompressed SEC1 pubkey. */
export function ethAddressFromPublicKey(publicKey: Uint8Array): string {
  return computeAddress(hexlify(publicKey));
}

export function publicKeyToHex(publicKey: Uint8Array): string {
  return hexlify(publicKey);
}

/**
 * Find Ethereum recovery id (v) so that recovering the digest yields `expectedAddress`.
 * Silence Laboratories returns only (r, s); v must be derived.
 */
export function resolveRecoveryId(
  digest32: Uint8Array,
  r: Uint8Array,
  s: Uint8Array,
  expectedAddress: string,
): number {
  const digestHex = hexlify(digest32);
  const expected = expectedAddress.toLowerCase();

  for (const v of [27, 28] as const) {
    try {
      const sig = Signature.from({
        r: hexlify(r),
        s: hexlify(s),
        v,
      });
      const recovered = SigningKey.recoverPublicKey(digestHex, sig);
      if (computeAddress(recovered).toLowerCase() === expected) {
        return v;
      }
    } catch {
      // try next v
    }
  }

  throw new Error('Unable to resolve ECDSA recovery id for MPC signature');
}

export function buildEcdsaSignature(
  digest32: Uint8Array,
  r: Uint8Array,
  s: Uint8Array,
  expectedAddress: string,
): MpcEcdsaSignature {
  if (digest32.length !== 32) {
    throw new Error('message digest must be 32 bytes');
  }
  if (r.length !== 32 || s.length !== 32) {
    throw new Error('r and s must be 32 bytes each');
  }

  const v = resolveRecoveryId(digest32, r, s, expectedAddress);
  return { r, s, v };
}

export function signatureToHex(sig: MpcEcdsaSignature): {
  r: string;
  s: string;
  v: number;
} {
  return {
    r: hexlify(sig.r),
    s: hexlify(sig.s),
    v: sig.v,
  };
}
