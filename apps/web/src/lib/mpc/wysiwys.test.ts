import { getBytes, Transaction } from "ethers";
import { describe, expect, it } from "vitest";
import { bytesToBase64, SEPOLIA_CHAIN_ID } from "@selfmade/mpc-crypto";
import {
  assertWysiwysDigest,
  encodeErc20Transfer,
  normalizeTxData,
  parseWithdrawAmountToWei,
  type UnsignedTxFields,
} from "./wysiwys";

describe("WYSIWYS digest check", () => {
  const to = "0x2222222222222222222222222222222222222222";
  const valueWei = 10n ** 15n;
  const tx: UnsignedTxFields = {
    to,
    value: valueWei.toString(),
    nonce: 7,
    gasLimit: "21000",
    maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "1000000000",
    chainId: SEPOLIA_CHAIN_ID.toString(),
    data: "0x",
  };

  function digestB64For(fields: UnsignedTxFields): string {
    const rebuilt = Transaction.from({
      type: 2,
      to: fields.to,
      value: BigInt(fields.value),
      nonce: fields.nonce,
      gasLimit: BigInt(fields.gasLimit),
      maxFeePerGas: BigInt(fields.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(fields.maxPriorityFeePerGas),
      chainId: BigInt(fields.chainId),
      data: normalizeTxData(fields.data),
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
    expect(parseWithdrawAmountToWei("1")).toBe(10n ** 18n);
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

  it("rejects non-Sepolia chainId", () => {
    const mainnet = { ...tx, chainId: "1" };
    expect(() =>
      assertWysiwysDigest({
        userToAddress: to,
        userAmount: "0.001",
        digestB64: digestB64For(mainnet),
        amountWei: valueWei.toString(),
        tx: mainnet,
      }),
    ).toThrow(/chainId/);
  });

  it("rejects unexpected calldata on native ETH withdraw", () => {
    const withData = {
      ...tx,
      data: "0xa9059cbb000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000038d7ea4c68000",
    };
    expect(() =>
      assertWysiwysDigest({
        userToAddress: to,
        userAmount: "0.001",
        digestB64: digestB64For(withData),
        amountWei: valueWei.toString(),
        tx: withData,
      }),
    ).toThrow(/tx\.data/);
  });

  it("accepts ERC-20 transfer intent: to=token, value=0, data=transfer", () => {
    const token = "0xc3CF22f1a32f360B685C56Da48481007d580cDb4";
    const data = encodeErc20Transfer(to, valueWei);
    const erc20: UnsignedTxFields = { ...tx, to: token, value: "0", data };
    const digestB64 = digestB64For(erc20);
    const digest = assertWysiwysDigest({
      userToAddress: to,
      userAmount: "0.001",
      digestB64,
      amountWei: valueWei.toString(),
      tx: erc20,
      asset: "ERC20",
      tokenAddress: token,
    });
    expect(digest).toHaveLength(32);

    expect(() =>
      assertWysiwysDigest({
        userToAddress: to,
        userAmount: "0.001",
        digestB64,
        amountWei: valueWei.toString(),
        tx: { ...erc20, value: valueWei.toString() },
        asset: "ERC20",
        tokenAddress: token,
      }),
    ).toThrow(/tx\.value/);
  });
});
