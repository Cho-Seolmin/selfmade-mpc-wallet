import {
  getAddress,
  getBytes,
  hexlify,
  parseEther,
  Signature,
  Transaction,
  type Provider,
} from 'ethers';
import type { MpcEcdsaSignature } from './index';

const TRANSFER_GAS_LIMIT = 21_000n;

export type PreparedFullBalanceTransfer = {
  tx: Transaction;
  balanceWei: bigint;
  feeWei: bigint;
  valueWei: bigint;
};

export type PreparedAmountTransfer = PreparedFullBalanceTransfer;

function resolveFees(feeData: {
  maxPriorityFeePerGas: bigint | null;
  maxFeePerGas: bigint | null;
  gasPrice: bigint | null;
}): { maxPriorityFeePerGas: bigint; maxFeePerGas: bigint; feeWei: bigint } {
  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas ?? 1_000_000_000n; // 1 gwei fallback
  const maxFeePerGas =
    feeData.maxFeePerGas ??
    (feeData.gasPrice
      ? feeData.gasPrice * 2n
      : maxPriorityFeePerGas * 2n);
  return {
    maxPriorityFeePerGas,
    maxFeePerGas,
    feeWei: TRANSFER_GAS_LIMIT * maxFeePerGas,
  };
}

/**
 * Build an EIP-1559 ETH transfer that sweeps (balance - max fee) to `toAddress`.
 * Partial amounts are intentionally unsupported for emergency last withdraw.
 */
export async function prepareFullBalanceTransfer(params: {
  provider: Provider;
  fromAddress: string;
  toAddress: string;
}): Promise<PreparedFullBalanceTransfer> {
  const from = getAddress(params.fromAddress);
  const to = getAddress(params.toAddress);
  if (from === to) {
    throw new Error('수신 주소가 출금 지갑과 같을 수 없습니다.');
  }

  const network = await params.provider.getNetwork();
  const balanceWei = await params.provider.getBalance(from);
  const nonce = await params.provider.getTransactionCount(from, 'pending');
  const fees = resolveFees(await params.provider.getFeeData());

  if (balanceWei === 0n) {
    throw new Error('ZERO_BALANCE');
  }
  if (balanceWei <= fees.feeWei) {
    throw new Error(
      `잔액이 가스비보다 작아 전액 출금할 수 없습니다. balance=${balanceWei} fee=${fees.feeWei}`,
    );
  }

  const valueWei = balanceWei - fees.feeWei;
  const tx = Transaction.from({
    type: 2,
    to,
    value: valueWei,
    nonce,
    gasLimit: TRANSFER_GAS_LIMIT,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    chainId: network.chainId,
  });

  return { tx, balanceWei, feeWei: fees.feeWei, valueWei };
}

/**
 * Build an EIP-1559 ETH transfer for a specific amount (normal A+B withdraw).
 * Requires balance >= amount + max fee.
 */
export async function prepareAmountTransfer(params: {
  provider: Provider;
  fromAddress: string;
  toAddress: string;
  amountWei: bigint;
}): Promise<PreparedAmountTransfer> {
  const from = getAddress(params.fromAddress);
  const to = getAddress(params.toAddress);
  if (from === to) {
    throw new Error('수신 주소가 출금 지갑과 같을 수 없습니다.');
  }
  if (params.amountWei <= 0n) {
    throw new Error('출금 금액은 0보다 커야 합니다.');
  }

  const network = await params.provider.getNetwork();
  const balanceWei = await params.provider.getBalance(from);
  const nonce = await params.provider.getTransactionCount(from, 'pending');
  const fees = resolveFees(await params.provider.getFeeData());

  if (balanceWei < params.amountWei + fees.feeWei) {
    throw new Error(
      `잔액이 부족합니다. 필요≈${params.amountWei + fees.feeWei} wei (금액+가스), 잔액=${balanceWei} wei`,
    );
  }

  const tx = Transaction.from({
    type: 2,
    to,
    value: params.amountWei,
    nonce,
    gasLimit: TRANSFER_GAS_LIMIT,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    chainId: network.chainId,
  });

  return {
    tx,
    balanceWei,
    feeWei: fees.feeWei,
    valueWei: params.amountWei,
  };
}

/** Parse user amount string as wei (accepts eth decimal or wei integer). */
export function parseWithdrawAmountToWei(amount: string): bigint {
  const trimmed = amount.trim();
  if (!trimmed) {
    throw new Error('출금 금액을 입력하세요.');
  }
  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  try {
    return parseEther(trimmed);
  } catch {
    throw new Error('출금 금액 형식이 올바르지 않습니다.');
  }
}

/** Attach MPC ECDSA signature and return raw signed tx hex. */
export function serializeSignedTransfer(
  tx: Transaction,
  signature: MpcEcdsaSignature,
): string {
  const signed = Transaction.from(tx);
  signed.signature = Signature.from({
    r: hexlify(signature.r),
    s: hexlify(signature.s),
    v: signature.v,
  });
  return signed.serialized;
}

export function unsignedTxDigest32(tx: Transaction): Uint8Array {
  return getBytes(tx.unsignedHash);
}

/** Rebuild Transaction from stored JSON fields (no signature). */
export function txFromStoredFields(fields: {
  to: string;
  value: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  chainId: string;
}): Transaction {
  return Transaction.from({
    type: 2,
    to: fields.to,
    value: BigInt(fields.value),
    nonce: fields.nonce,
    gasLimit: BigInt(fields.gasLimit),
    maxFeePerGas: BigInt(fields.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(fields.maxPriorityFeePerGas),
    chainId: BigInt(fields.chainId),
  });
}
