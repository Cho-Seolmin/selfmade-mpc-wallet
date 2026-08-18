import { getAddress, getBytes, hexlify, Interface, parseEther, Transaction } from "ethers";
import { base64ToBytes, bytesToBase64, SEPOLIA_CHAIN_ID } from "@selfmade/mpc-crypto";

export type WithdrawAsset = "ETH" | "ERC20";

export type UnsignedTxFields = {
  to: string;
  value: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  chainId: string;
  /** Hex calldata. ETH = `0x`; ERC-20 = encoded transfer(to, amount). */
  data?: string;
};

const ERC20_TRANSFER_IFACE = new Interface([
  "function transfer(address to, uint256 amount)",
]);

/** Canonical hex for tx.data so `0x` / empty / mixed-case compare equal. */
export function normalizeTxData(data?: string | null): string {
  const trimmed = (data ?? "").trim();
  if (!trimmed || /^0x$/i.test(trimmed)) return "0x";
  if (!/^0x[0-9a-fA-F]*$/i.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new Error("WYSIWYS: tx.data가 유효한 hex가 아닙니다.");
  }
  return `0x${trimmed.slice(2).toLowerCase()}`;
}

export function encodeErc20Transfer(to: string, amount: bigint): string {
  return normalizeTxData(
    ERC20_TRANSFER_IFACE.encodeFunctionData("transfer", [
      getAddress(to),
      amount,
    ]),
  );
}

/** Match API: user amount is always ETH decimal ("1" = 1 ETH). */
export function parseWithdrawAmountToWei(amount: string): bigint {
  const trimmed = amount.trim();
  if (!trimmed) {
    throw new Error("출금 금액을 입력하세요.");
  }
  try {
    const wei = parseEther(trimmed);
    if (wei <= 0n) {
      throw new Error("출금 금액은 0보다 커야 합니다.");
    }
    return wei;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("0보다")) {
      throw err;
    }
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
 * ETH: to=recipient, value=amount, data=0x.
 * ERC-20: to=token, value=0, data=transfer(recipient, amount).
 */
export function assertWysiwysDigest(params: {
  userToAddress: string;
  userAmount: string;
  digestB64: string;
  amountWei: string;
  tx: UnsignedTxFields;
  /** Expected calldata. Native ETH omits or passes `0x`. */
  userData?: string;
  asset?: WithdrawAsset;
  tokenAddress?: string;
}): Uint8Array {
  const expectedWei = parseWithdrawAmountToWei(params.userAmount);
  const expectedRecipient = getAddress(params.userToAddress);
  const txData = normalizeTxData(params.tx.data);
  const asset: WithdrawAsset = params.asset === "ERC20" ? "ERC20" : "ETH";

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

  if (asset === "ERC20") {
    if (!params.tokenAddress) {
      throw new Error("WYSIWYS: ERC-20 출금에 토큰 주소가 없습니다.");
    }
    const expectedToken = getAddress(params.tokenAddress);
    const expectedData = encodeErc20Transfer(expectedRecipient, expectedWei);
    if (txTo !== expectedToken) {
      throw new Error(
        "WYSIWYS: 서버 tx.to가 토큰 컨트랙트와 일치하지 않습니다. 서명을 중단합니다.",
      );
    }
    if (params.tx.value !== "0") {
      throw new Error(
        "WYSIWYS: ERC-20 출금의 tx.value는 0이어야 합니다. 서명을 중단합니다.",
      );
    }
    if (txData !== expectedData) {
      throw new Error(
        "WYSIWYS: 서버 tx.data가 transfer(수신주소, 금액)과 일치하지 않습니다. 서명을 중단합니다.",
      );
    }
  } else {
    const expectedData = normalizeTxData(params.userData);
    if (txTo !== expectedRecipient) {
      throw new Error(
        "WYSIWYS: 서버 tx.to가 입력 수신 주소와 일치하지 않습니다. 서명을 중단합니다.",
      );
    }
    if (params.tx.value !== expectedWei.toString()) {
      throw new Error(
        "WYSIWYS: 서버 tx.value가 입력 금액과 일치하지 않습니다. 서명을 중단합니다.",
      );
    }
    if (txData !== expectedData) {
      throw new Error(
        "WYSIWYS: 서버 tx.data가 의도한 calldata와 일치하지 않습니다. 서명을 중단합니다.",
      );
    }
  }

  let chainId: bigint;
  try {
    chainId = BigInt(params.tx.chainId);
  } catch {
    throw new Error("WYSIWYS: 서버 tx.chainId가 유효하지 않습니다.");
  }
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      "WYSIWYS: chainId가 Sepolia(11155111)가 아닙니다. 서명을 중단합니다.",
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
    chainId: SEPOLIA_CHAIN_ID,
    data: txData,
  });

  if (normalizeTxData(hexlify(rebuilt.data)) !== txData) {
    throw new Error("WYSIWYS: 재구성한 tx.data가 일치하지 않습니다.");
  }

  const localDigest = getBytes(rebuilt.unsignedHash);
  const serverDigest = base64ToBytes(params.digestB64);
  if (!bytesEqual(localDigest, serverDigest)) {
    throw new Error(
      "WYSIWYS: 로컬 재계산 digest가 서버 digestB64와 다릅니다. 서명을 중단합니다.",
    );
  }

  if (bytesToBase64(localDigest) !== params.digestB64) {
    throw new Error("WYSIWYS: digest 인코딩 불일치.");
  }

  return localDigest;
}
