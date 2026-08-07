import { createHash, randomBytes } from 'crypto';
import { Signature, SigningKey, computeAddress, hexlify } from 'ethers';
import { base64ToBytes, bytesEqual } from '@selfmade/mpc-crypto';
import {
  MPC_PARTY,
  generateMpcKeyshares,
  getShareByParty,
  thresholdSignDigest,
} from './index';

describe('MPC crypto layer (DKLs23 2-of-3)', () => {
  it('generates three shares with identical public key and valid eth address', () => {
    const { address, publicKeyHex, shares } = generateMpcKeyshares();

    expect(shares).toHaveLength(3);
    expect(shares.map((s) => s.partyId).sort()).toEqual([0, 1, 2]);
    expect(shares.every((s) => s.threshold === 2)).toBe(true);
    expect(shares.every((s) => s.participants === 3)).toBe(true);
    expect(shares.every((s) => s.publicKeyHex === publicKeyHex)).toBe(true);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(computeAddress(publicKeyHex)).toBe(address);

    // Share blobs must differ (different party material).
    expect(shares[0].shareB64).not.toEqual(shares[1].shareB64);
    expect(shares[1].shareB64).not.toEqual(shares[2].shareB64);
  });

  it.each([
    ['A+B', [MPC_PARTY.A, MPC_PARTY.B]],
    ['B+C', [MPC_PARTY.B, MPC_PARTY.C]],
    ['A+C', [MPC_PARTY.A, MPC_PARTY.C]],
  ] as const)(
    'threshold-signs with %s without reconstructing a private key',
    (_label, partyIds) => {
      const { address, shares } = generateMpcKeyshares();
      const digest = createHash('sha256')
        .update(randomBytes(16))
        .digest();

      const selected = partyIds.map((id) => getShareByParty(shares, id));
      const result = thresholdSignDigest(selected, digest);

      expect(result.address).toBe(address);
      expect(result.signature.r).toHaveLength(32);
      expect(result.signature.s).toHaveLength(32);
      expect([27, 28]).toContain(result.signature.v);

      const sig = Signature.from({
        r: hexlify(result.signature.r),
        s: hexlify(result.signature.s),
        v: result.signature.v,
      });
      const recovered = SigningKey.recoverPublicKey(hexlify(digest), sig);
      expect(computeAddress(recovered)).toBe(address);
    },
  );

  it('round-trips share serialization', () => {
    const { shares } = generateMpcKeyshares();
    const raw = base64ToBytes(shares[0].shareB64);
    expect(raw.byteLength).toBeGreaterThan(32);
    expect(bytesEqual(raw, base64ToBytes(shares[0].shareB64))).toBe(true);
  });
});
