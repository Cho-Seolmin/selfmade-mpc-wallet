import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertRecoveryPin, bytesToBase64 } from "./browser-crypto";
import {
  deleteBrowserShareA,
  hasBrowserShareA,
  loadBrowserShareABytes,
  saveBrowserShareA,
} from "./browser-share-store";
import {
  createRecoveryFile,
  decryptShareAFromRecoveryFile,
  parseRecoveryFileJson,
} from "./recovery-file";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

describe("browser Share A + Recovery File", () => {
  it("rejects non 6-digit PIN", () => {
    expect(() => assertRecoveryPin("12345")).toThrow(/6자리/);
    expect(() => assertRecoveryPin("12345a")).toThrow(/6자리/);
  });

  it("round-trips Share A through IndexedDB AES-GCM", async () => {
    const share = crypto.getRandomValues(new Uint8Array(96));
    const walletId = `wallet_${Date.now()}`;

    await saveBrowserShareA({
      walletId,
      address: "0xabc",
      publicKeyHex: "0x03aa",
      shareABytes: share,
    });

    expect(await hasBrowserShareA(walletId)).toBe(true);
    const loaded = await loadBrowserShareABytes(walletId);
    expect(Buffer.from(loaded)).toEqual(Buffer.from(share));

    await deleteBrowserShareA(walletId);
    expect(await hasBrowserShareA(walletId)).toBe(false);
  });

  it("encrypts Recovery File with PIN and decrypts Share A", async () => {
    const share = crypto.getRandomValues(new Uint8Array(64));
    const pin = "847291";

    const file = await createRecoveryFile({
      walletId: "w1",
      address: "0x1111111111111111111111111111111111111111",
      publicKeyHex: "0x03bbbb",
      shareABytes: share,
      pin,
    });

    expect(file.scheme).toBe("selfmade-mpc-recovery");
    expect(file.cipher.ciphertextB64).toBeTruthy();
    expect(JSON.stringify(file)).not.toContain(bytesToBase64(share));
    expect(file).not.toHaveProperty("shareA");
    expect(file).not.toHaveProperty("privateKey");

    const roundtrip = await decryptShareAFromRecoveryFile(file, pin);
    expect(Buffer.from(roundtrip)).toEqual(Buffer.from(share));

    await expect(
      decryptShareAFromRecoveryFile(file, "000000"),
    ).rejects.toThrow(/PIN/);

    const parsed = parseRecoveryFileJson(JSON.stringify(file));
    expect(parsed.walletId).toBe("w1");
  });

  it("restores Share A from Recovery File into IndexedDB", async () => {
    const { restoreBrowserShareA } = await import("./restore-browser-share");
    const share = crypto.getRandomValues(new Uint8Array(80));
    const pin = "192837";
    const walletId = `restore_${Date.now()}`;
    const address = "0x2222222222222222222222222222222222222222";
    const publicKeyHex = "0x03cccc";

    const file = await createRecoveryFile({
      walletId,
      address,
      publicKeyHex,
      shareABytes: share,
      pin,
    });

    await expect(
      restoreBrowserShareA({
        recoveryFileJson: JSON.stringify(file),
        pin,
        expectedWallet: {
          id: "other-wallet",
          address,
          mpcPublicKey: publicKeyHex,
        },
      }),
    ).rejects.toThrow(/walletId/);

    const restored = await restoreBrowserShareA({
      recoveryFileJson: JSON.stringify(file),
      pin,
      expectedWallet: {
        id: walletId,
        address,
        mpcPublicKey: publicKeyHex,
      },
    });

    expect(restored.meta.walletId).toBe(walletId);
    expect(await hasBrowserShareA(walletId)).toBe(true);
    const loaded = await loadBrowserShareABytes(walletId);
    expect(Buffer.from(loaded)).toEqual(Buffer.from(share));

    await expect(
      restoreBrowserShareA({
        recoveryFileJson: JSON.stringify(file),
        pin,
        expectedWallet: {
          id: walletId,
          address,
          mpcPublicKey: publicKeyHex,
        },
        overwrite: false,
      }),
    ).rejects.toThrow(/이미 있습니다/);

    await expect(
      restoreBrowserShareA({
        recoveryFileJson: JSON.stringify(file),
        pin: "000000",
        expectedWallet: {
          id: walletId,
          address,
          mpcPublicKey: publicKeyHex,
        },
        overwrite: true,
      }),
    ).rejects.toThrow(/PIN/);

    const share2 = crypto.getRandomValues(new Uint8Array(80));
    const file2 = await createRecoveryFile({
      walletId,
      address,
      publicKeyHex,
      shareABytes: share2,
      pin,
    });
    await restoreBrowserShareA({
      recoveryFileJson: JSON.stringify(file2),
      pin,
      expectedWallet: {
        id: walletId,
        address,
        mpcPublicKey: publicKeyHex,
      },
      overwrite: true,
    });
    const loaded2 = await loadBrowserShareABytes(walletId);
    expect(Buffer.from(loaded2)).toEqual(Buffer.from(share2));

    await deleteBrowserShareA(walletId);
  });
});
