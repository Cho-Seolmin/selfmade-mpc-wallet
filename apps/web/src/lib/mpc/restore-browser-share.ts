import { getAddress } from "ethers";
import {
  clearLegacySessionShareA,
  hasBrowserShareA,
  saveBrowserShareA,
  type StoredBrowserShareMeta,
} from "./browser-share-store";
import {
  decryptShareAFromRecoveryFile,
  parseRecoveryFileJson,
  type MpcRecoveryFile,
} from "./recovery-file";
import { reportWalletAuditEvent } from "../../api/wallet";

export type RestoreBrowserShareParams = {
  /** Raw Recovery File JSON text (from file upload). */
  recoveryFileJson: string;
  pin: string;
  /** Expected live wallet from Main API (must match file metadata). */
  expectedWallet: {
    id: string;
    address: string;
    mpcPublicKey?: string | null;
  };
  /** Overwrite existing IndexedDB Share A for this wallet. */
  overwrite?: boolean;
};

export type RestoreBrowserShareResult = {
  meta: StoredBrowserShareMeta;
  recoveryFile: MpcRecoveryFile;
};

function normalizeAddress(address: string): string {
  try {
    return getAddress(address);
  } catch {
    throw new Error("지갑 주소 형식이 올바르지 않습니다.");
  }
}

/**
 * Browser-side Share A recovery:
 * Recovery File + PIN → decrypt in browser → IndexedDB AES-GCM re-store.
 * Never sends Share A or PIN to the server.
 */
export async function restoreBrowserShareA(
  params: RestoreBrowserShareParams,
): Promise<RestoreBrowserShareResult> {
  const file = parseRecoveryFileJson(params.recoveryFileJson);

  if (file.walletId !== params.expectedWallet.id) {
    throw new Error(
      "이 Recovery File은 현재 로그인한 지갑용 파일이 아닙니다. 올바른 파일을 선택하세요.",
    );
  }

  const fileAddress = normalizeAddress(file.address);
  const walletAddress = normalizeAddress(params.expectedWallet.address);
  if (fileAddress !== walletAddress) {
    throw new Error(
      "Recovery File의 지갑 주소가 현재 지갑과 다릅니다. 다른 계정의 파일일 수 있습니다.",
    );
  }

  if (params.expectedWallet.mpcPublicKey) {
    const expectedPk = params.expectedWallet.mpcPublicKey.toLowerCase();
    const filePk = file.publicKeyHex.toLowerCase();
    if (expectedPk !== filePk) {
      throw new Error(
        "Recovery File의 공개키가 현재 지갑과 일치하지 않습니다.",
      );
    }
  }

  const exists = await hasBrowserShareA(params.expectedWallet.id);
  if (exists && !params.overwrite) {
    throw new Error(
      "이 브라우저에 Share A가 이미 있습니다. 덮어쓰려면 overwrite를 허용하세요.",
    );
  }

  let shareABytes: Uint8Array | null = null;
  try {
    shareABytes = await decryptShareAFromRecoveryFile(file, params.pin);

    const meta = await saveBrowserShareA({
      walletId: file.walletId,
      address: fileAddress,
      publicKeyHex: file.publicKeyHex,
      shareABytes,
    });
    clearLegacySessionShareA(file.walletId);

    await reportWalletAuditEvent(file.walletId, {
      eventType: "BROWSER_SHARE_RECOVERED",
      data: { address: fileAddress },
    }).catch(() => undefined);

    return { meta, recoveryFile: file };
  } finally {
    if (shareABytes) {
      shareABytes.fill(0);
    }
  }
}

export async function readRecoveryFileFromBlob(file: File): Promise<string> {
  if (!file.name.toLowerCase().endsWith(".json") && file.type && !file.type.includes("json")) {
    // Allow empty type from some OS pickers; still require readable text.
  }
  const text = await file.text();
  if (!text.trim()) {
    throw new Error("Recovery File이 비어 있습니다.");
  }
  return text;
}
