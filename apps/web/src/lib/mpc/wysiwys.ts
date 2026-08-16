import { getAddress, getBytes, parseEther, Transaction } from "ethers";
import { base64ToBytes, bytesToBase64 } from "@selfmade/mpc-crypto";

export type UnsignedTxFields = {
  to: string;
  value: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  chainId: string;
};

/** Match API parseWithdrawAmountToWei (eth decimal or wei integer). */
export function parseWithdrawAmountToWei(amount: string): bigint {
  const trimmed = amount.trim();
  if (!trimmed) {
    throw new Error("출금 금액을 입력하세요.");
  }
  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  try {
    return parseEther(trimmed);
  } catch {
    throw new Error("출금 금액 형식이 올바르지 않습니다.");
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * WYSIWYS: rebuild unsigned tx, recompute digest, bind to UI intent.
 * Throws if server digest/tx does not match what the user asked to sign.
 */
export function assertWysiwysDigest(params: {
  userToAddress: string;
  userAmount: string;
  digestB64: string;
  amountWei: string;
  tx: UnsignedTxFields;
}): Uint8Array {
  const expectedWei = parseWithdrawAmountToWei(params.userAmount);
  const expectedTo = getAddress(params.userToAddress);

  if (params.amountWei !== expectedWei.toString()) {
    throw new Error(
      "WYSIWYS: 서버 amountWei가 입력 금액과 일치하지 않습니다. 서명을 중단합니다.",
    );
  }

  let txTo: string;
  try {
    txTo = getAddress(params.tx.to);
  } catch {
    throw new Error("WYSIWYS: 서버 tx.to가 유효한 주소가 아닙니다.");
  }
  if (txTo !== expectedTo) {
    throw new Error(
      "WYSIWYS: 서버 tx.to가 입력 수신 주소와 일치하지 않습니다. 서명을 중단합니다.",
    );
  }
  if (params.tx.value !== expectedWei.toString()) {
    throw new Error(
      "WYSIWYS: 서버 tx.value가 입력 금액과 일치하지 않습니다. 서명을 중단합니다.",
    );
  }

  const rebuilt = Transaction.from({
    type: 2,
    to: txTo,
    value: BigInt(params.tx.value),
    nonce: params.tx.nonce,
    gasLimit: BigInt(params.tx.gasLimit),
    maxFeePerGas: BigInt(params.tx.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(params.tx.maxPriorityFeePerGas),
    chainId: BigInt(params.tx.chainId),
  });

  const localDigest = getBytes(rebuilt.unsignedHash);
  const serverDigest = base64ToBytes(params.digestB64);
  if (!bytesEqual(localDigest, serverDigest)) {
    throw new Error(
      "WYSIWYS: 로컬 재계산 digest가 서버 digestB64와 다릅니다. 서명을 중단합니다.",
    );
  }

  // Sanity: round-trip encoding matches what we will sign.
  if (bytesToBase64(localDigest) !== params.digestB64) {
    throw new Error("WYSIWYS: digest 인코딩 불일치.");
  }

  return localDigest;
}
