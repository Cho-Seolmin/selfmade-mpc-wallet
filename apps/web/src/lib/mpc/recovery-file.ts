import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  assertRecoveryPin,
  base64ToBytes,
  bytesToBase64,
  derivePinAesKey,
} from "./browser-crypto";

export const RECOVERY_FILE_SCHEME = "selfmade-mpc-recovery" as const;
export const RECOVERY_FILE_VERSION = 1 as const;

/**
 * Recovery File format.
 * Contains only PIN-encrypted Share A — never a full private key plaintext.
 */
export type MpcRecoveryFile = {
  version: typeof RECOVERY_FILE_VERSION;
  scheme: typeof RECOVERY_FILE_SCHEME;
  walletId: string;
  address: string;
  publicKeyHex: string;
  partyId: 0;
  network: "sepolia";
  createdAt: string;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: 210000;
    saltB64: string;
  };
  cipher: {
    name: "AES-GCM";
    ivB64: string;
    ciphertextB64: string;
  };
};

export async function createRecoveryFile(params: {
  walletId: string;
  address: string;
  publicKeyHex: string;
  shareABytes: Uint8Array;
  pin: string;
}): Promise<MpcRecoveryFile> {
  assertRecoveryPin(params.pin);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derivePinAesKey(params.pin, salt, ["encrypt"]);
  const { iv, ciphertext } = await aesGcmEncrypt(key, params.shareABytes);

  return {
    version: RECOVERY_FILE_VERSION,
    scheme: RECOVERY_FILE_SCHEME,
    walletId: params.walletId,
    address: params.address,
    publicKeyHex: params.publicKeyHex,
    partyId: 0,
    network: "sepolia",
    createdAt: new Date().toISOString(),
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 210_000,
      saltB64: bytesToBase64(salt),
    },
    cipher: {
      name: "AES-GCM",
      ivB64: bytesToBase64(iv),
      ciphertextB64: bytesToBase64(ciphertext),
    },
  };
}

export function parseRecoveryFileJson(raw: string): MpcRecoveryFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Recovery File JSON을 파싱할 수 없습니다.");
  }

  const file = parsed as MpcRecoveryFile;
  if (
    file?.version !== RECOVERY_FILE_VERSION ||
    file?.scheme !== RECOVERY_FILE_SCHEME ||
    typeof file.walletId !== "string" ||
    typeof file.address !== "string" ||
    typeof file.publicKeyHex !== "string" ||
    !file.kdf?.saltB64 ||
    !file.cipher?.ivB64 ||
    !file.cipher?.ciphertextB64
  ) {
    throw new Error("유효하지 않은 Recovery File 형식입니다.");
  }

  // Defense: reject accidental plaintext share fields if ever present.
  const banned = ["share", "shareA", "shareB64", "privateKey", "plaintext"];
  for (const key of banned) {
    if (key in (file as unknown as Record<string, unknown>)) {
      throw new Error("Recovery File에 허용되지 않은 필드가 있습니다.");
    }
  }

  return file;
}

/** Decrypt Share A from Recovery File using PIN (browser-side only). */
export async function decryptShareAFromRecoveryFile(
  file: MpcRecoveryFile,
  pin: string,
): Promise<Uint8Array> {
  assertRecoveryPin(pin);
  const salt = base64ToBytes(file.kdf.saltB64);
  const key = await derivePinAesKey(pin, salt, ["decrypt"]);
  try {
    return await aesGcmDecrypt(
      key,
      base64ToBytes(file.cipher.ivB64),
      base64ToBytes(file.cipher.ciphertextB64),
    );
  } catch {
    throw new Error("Recovery PIN이 올바르지 않거나 파일이 손상되었습니다.");
  }
}

export function downloadRecoveryFile(file: MpcRecoveryFile): void {
  const short = file.address.slice(2, 8).toLowerCase();
  const stamp = file.createdAt.slice(0, 10);
  const filename = `mpc-recovery-${short}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
