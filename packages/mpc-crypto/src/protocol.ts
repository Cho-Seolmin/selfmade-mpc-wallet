import {
  MPC_CHAIN_PATH,
  MPC_PARTIES,
  MPC_THRESHOLD,
} from './constants';
import {
  ethAddressFromPublicKey,
  publicKeyToHex,
  buildEcdsaSignature,
} from './ethereum';
import {
  filterMessages,
  selectMessages,
  bytesToBase64,
  bytesEqual,
} from './routing';
import type {
  KeygenSessionCtor,
  KeyshareStatic,
  MpcKeyshare,
  MpcKeyshareRecord,
  MpcEcdsaSignature,
  SignSessionCtor,
} from './types';

/**
 * In-process 2-of-3 (or general t-of-n) DKG.
 * Used for unit tests and local spikes. Production flow will run the same
 * rounds across Browser / Main API / Recovery via HTTP message relay.
 */
export function runInProcessDkg(
  KeygenSession: KeygenSessionCtor,
  options?: {
    participants?: number;
    threshold?: number;
  },
): MpcKeyshare[] {
  const n = options?.participants ?? MPC_PARTIES;
  const t = options?.threshold ?? MPC_THRESHOLD;

  const parties = Array.from(
    { length: n },
    (_, partyId) => new KeygenSession(n, t, partyId),
  );

  try {
    const msg1 = parties.map((p) => p.createFirstMessage());
    const msg2 = parties.flatMap((p, pid) =>
      p.handleMessages(filterMessages(msg1, pid)),
    );
    const commitments = parties.map((p) => p.calculateChainCodeCommitment());
    const msg3 = parties.flatMap((p, pid) =>
      p.handleMessages(selectMessages(msg2, pid)),
    );
    const msg4 = parties.flatMap((p, pid) =>
      p.handleMessages(selectMessages(msg3, pid), commitments),
    );
    parties.flatMap((p, pid) => p.handleMessages(filterMessages(msg4, pid)));

    return parties.map((p) => p.keyshare());
  } catch (error) {
    for (const p of parties) {
      try {
        p.free();
      } catch {
        // ignore cleanup errors
      }
    }
    throw error;
  }
}

export function keyshareToRecord(share: MpcKeyshare): MpcKeyshareRecord {
  return {
    partyId: share.partyId,
    participants: share.participants,
    threshold: share.threshold,
    publicKeyHex: publicKeyToHex(share.publicKey),
    shareB64: bytesToBase64(share.toBytes()),
  };
}

/**
 * Threshold-sign a 32-byte digest with an arbitrary subset of keyshares.
 *
 * IMPORTANT:
 * - Silence Laboratories `SignSession` consumes the Keyshare instance.
 *   Always pass serialized bytes so callers keep durable copies.
 * - Route messages by real `partyId`, not by local array index
 *   (needed for B+C where ids are 1 and 2).
 * - Pre-signatures must never be reused.
 */
export function runInProcessSign(
  Keyshare: KeyshareStatic,
  SignSession: SignSessionCtor,
  shareBytesList: Uint8Array[],
  digest32: Uint8Array,
  chainPath: string = MPC_CHAIN_PATH,
): { signatures: Uint8Array[][]; publicKey: Uint8Array } {
  if (digest32.length !== 32) {
    throw new Error('digest32 must be exactly 32 bytes');
  }
  if (shareBytesList.length < 2) {
    throw new Error('at least two keyshares are required for threshold signing');
  }

  const liveShares = shareBytesList.map((bytes) => Keyshare.fromBytes(bytes));
  const partyIds = liveShares.map((s) => s.partyId);
  const publicKey = new Uint8Array(liveShares[0].publicKey);

  for (let i = 1; i < liveShares.length; i++) {
    if (!bytesEqual(publicKey, liveShares[i].publicKey)) {
      liveShares.forEach((s) => s.free());
      throw new Error('keyshare public keys do not match');
    }
  }

  // SignSession constructor consumes each Keyshare.
  const parties = liveShares.map(
    (share) => new SignSession(share, chainPath),
  );

  try {
    const msg1 = parties.map((p) => p.createFirstMessage());
    const msg2 = parties.flatMap((p, i) =>
      p.handleMessages(filterMessages(msg1, partyIds[i])),
    );
    const msg3 = parties.flatMap((p, i) =>
      p.handleMessages(selectMessages(msg2, partyIds[i])),
    );
    parties.flatMap((p, i) =>
      p.handleMessages(selectMessages(msg3, partyIds[i])),
    );

    const msg4 = parties.map((p) => p.lastMessage(digest32));
    const signatures = parties.map((p, i) =>
      p.combine(filterMessages(msg4, partyIds[i])),
    );

    return { signatures, publicKey };
  } catch (error) {
    for (const p of parties) {
      try {
        p.free();
      } catch {
        // ignore cleanup errors
      }
    }
    throw error;
  }
}

/** Convenience: sign and attach Ethereum recovery id against the group address. */
export function signDigestForEthereum(
  Keyshare: KeyshareStatic,
  SignSession: SignSessionCtor,
  shareBytesList: Uint8Array[],
  digest32: Uint8Array,
): {
  address: string;
  signature: MpcEcdsaSignature;
  publicKeyHex: string;
} {
  const { signatures, publicKey } = runInProcessSign(
    Keyshare,
    SignSession,
    shareBytesList,
    digest32,
  );
  const address = ethAddressFromPublicKey(publicKey);
  const [r, s] = signatures[0];
  const signature = buildEcdsaSignature(digest32, r, s, address);

  return {
    address,
    signature,
    publicKeyHex: publicKeyToHex(publicKey),
  };
}
