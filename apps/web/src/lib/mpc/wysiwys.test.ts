import { getBytes, Transaction } from "ethers";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "@selfmade/mpc-crypto";
import { assertWysiwysDigest, parseWithdrawAmountToWei } from "./wysiwys";

describe("WYSIWYS digest check", () => {
  const to = "0x2222222222222222222222222222222222222222";
  const valueWei = 10n ** 15n;
  const tx = {
    to,
    value: valueWei.toString(),
    nonce: 7,
    gasLimit: "21000",
    maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "1000000000",
    chainId: "11155111",
  };

  function digestB64For(fields: typeof tx): string {
    const rebuilt = Transaction.from({
      type: 2,
      to: fields.to,
      value: BigInt(fields.value),
      nonce: fields.nonce,
      gasLimit: BigInt(fields.gasLimit),
      maxFeePerGas: BigInt(fields.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(fields.maxPriorityFeePerGas),
      chainId: BigInt(fields.chainId),
    });
    return bytesToBase64(getBytes(rebuilt.unsignedHash));
  }

  it("accepts matching UI intent and digest", () => {
    const digestB64 = digestB64For(tx);
    const digest = assertWysiwysDigest({
      userToAddress: to,
      userAmount: "0.001",
      digestB64,
      amountWei: valueWei.toString(),
      tx,
    });
    expect(digest).toHaveLength(32);
    expect(parseWithdrawAmountToWei("0.001")).toBe(valueWei);
  });

  it("rejects swapped recipient", () => {
    expect(() =>
      assertWysiwysDigest({
        userToAddress: "0x3333333333333333333333333333333333333333",
        userAmount: "0.001",
        digestB64: digestB64For(tx),
        amountWei: valueWei.toString(),
        tx,
      }),
    ).toThrow(/tx\.to/);
  });

  it("rejects digest mismatch", () => {
    const bad = { ...tx, nonce: 99 };
    expect(() =>
      assertWysiwysDigest({
        userToAddress: to,
        userAmount: "0.001",
        digestB64: digestB64For(tx),
        amountWei: valueWei.toString(),
        tx: bad,
      }),
    ).toThrow(/digest/);
  });
});
