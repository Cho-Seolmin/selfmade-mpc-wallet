import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
  generateDeviceAesKey,
} from "./browser-crypto";

const DB_NAME = "selfmade-mpc-wallet";
const DB_VERSION = 1;
const STORE = "browserShares";

export type StoredBrowserShareMeta = {
  walletId: string;
  address: string;
  publicKeyHex: string;
  createdAt: string;
};

type StoredBrowserShareRecord = StoredBrowserShareMeta & {
  /** Non-extractable AES-GCM device key (structured-clone into IndexedDB). */
  deviceKey: CryptoKey;
  ivB64: string;
  ciphertextB64: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "walletId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Encrypt Share A with a non-extractable device AES key and persist in IndexedDB.
 * Never stores plaintext Share A.
 */
export async function saveBrowserShareA(params: {
  walletId: string;
  address: string;
  publicKeyHex: string;
  shareABytes: Uint8Array;
}): Promise<StoredBrowserShareMeta> {
  const deviceKey = await generateDeviceAesKey();
  const { iv, ciphertext } = await aesGcmEncrypt(deviceKey, params.shareABytes);

  const record: StoredBrowserShareRecord = {
    walletId: params.walletId,
    address: params.address,
    publicKeyHex: params.publicKeyHex,
    createdAt: new Date().toISOString(),
    deviceKey,
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(ciphertext),
  };

  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await idbReq(tx.objectStore(STORE).put(record));
  } finally {
    db.close();
  }

  return {
    walletId: record.walletId,
    address: record.address,
    publicKeyHex: record.publicKeyHex,
    createdAt: record.createdAt,
  };
}

export async function hasBrowserShareA(walletId: string): Promise<boolean> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const row = await idbReq(
      tx.objectStore(STORE).get(walletId) as IDBRequest<
        StoredBrowserShareRecord | undefined
      >,
    );
    return Boolean(row?.ciphertextB64 && row.deviceKey);
  } finally {
    db.close();
  }
}

/** Decrypt Share A for signing. Caller must not log or persist the result. */
export async function loadBrowserShareABytes(
  walletId: string,
): Promise<Uint8Array> {
  const db = await openDb();
  let row: StoredBrowserShareRecord | undefined;
  try {
    const tx = db.transaction(STORE, "readonly");
    row = await idbReq(
      tx.objectStore(STORE).get(walletId) as IDBRequest<
        StoredBrowserShareRecord | undefined
      >,
    );
  } finally {
    db.close();
  }

  if (!row) {
    throw new Error("이 브라우저에 Share A가 없습니다. Recovery File로 복구하세요.");
  }

  return aesGcmDecrypt(
    row.deviceKey,
    base64ToBytes(row.ivB64),
    base64ToBytes(row.ciphertextB64),
  );
}

export async function deleteBrowserShareA(walletId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await idbReq(tx.objectStore(STORE).delete(walletId));
  } finally {
    db.close();
  }
}

/** Clear legacy STEP 4 sessionStorage Share A blobs if present. */
export function clearLegacySessionShareA(walletId?: string): void {
  try {
    if (walletId) {
      sessionStorage.removeItem(`mpc.shareA.${walletId}`);
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("mpc.shareA.")) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}
