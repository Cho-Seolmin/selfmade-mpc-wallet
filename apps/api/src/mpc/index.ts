import {
  MPC_CHAIN_PATH,
  MPC_PARTIES,
  MPC_PARTY,
  MPC_SCHEME,
  MPC_SCHEME_VERSION,
  MPC_THRESHOLD,
  base64ToBytes,
  bytesToBase64,
  ethAddressFromPublicKey,
  keyshareToRecord,
  publicKeyToHex,
  runInProcessDkg,
  signDigestForEthereum,
  type MpcEcdsaSignature,
  type MpcKeyshareRecord,
} from '@selfmade/mpc-crypto';
import { KeygenSession, Keyshare, SignSession } from './wasm';

export {
  MPC_CHAIN_PATH,
  MPC_PARTIES,
  MPC_PARTY,
  MPC_SCHEME,
  MPC_SCHEME_VERSION,
  MPC_THRESHOLD,
};

export type { MpcEcdsaSignature, MpcKeyshareRecord };

/** Run local 2-of-3 DKG and return durable (serializable) share records. */
export function generateMpcKeyshares(): {
  address: string;
  publicKeyHex: string;
  shares: MpcKeyshareRecord[];
} {
  const live = runInProcessDkg(KeygenSession, {
    participants: MPC_PARTIES,
    threshold: MPC_THRESHOLD,
  });

  try {
    const publicKeyHex = publicKeyToHex(live[0].publicKey);
    const address = ethAddressFromPublicKey(live[0].publicKey);
    const shares = live.map((share) => keyshareToRecord(share));
    return { address, publicKeyHex, shares };
  } finally {
    for (const share of live) {
      share.free();
    }
  }
}

export function encodeShareBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

export function decodeShareBytes(shareB64: string): Uint8Array {
  return base64ToBytes(shareB64);
}

export function loadKeyshare(shareB64: string): Keyshare {
  return Keyshare.fromBytes(decodeShareBytes(shareB64));
}

/**
 * Threshold-sign a 32-byte digest with the given durable shares (e.g. A+B or B+C).
 * Does not reconstruct a full private key.
 */
export function thresholdSignDigest(
  shareRecords: Pick<MpcKeyshareRecord, 'shareB64'>[],
  digest32: Uint8Array,
): {
  address: string;
  publicKeyHex: string;
  signature: MpcEcdsaSignature;
} {
  const shareBytes = shareRecords.map((s) => decodeShareBytes(s.shareB64));
  return signDigestForEthereum(Keyshare, SignSession, shareBytes, digest32);
}

export function getShareByParty(
  shares: MpcKeyshareRecord[],
  partyId: number,
): MpcKeyshareRecord {
  const found = shares.find((s) => s.partyId === partyId);
  if (!found) {
    throw new Error(`missing keyshare for party ${partyId}`);
  }
  return found;
}
