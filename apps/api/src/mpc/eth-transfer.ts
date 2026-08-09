import {
  getAddress,
  getBytes,
  hexlify,
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
  const feeData = await params.provider.getFeeData();

  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas ?? 1_000_000_000n; // 1 gwei fallback
  const maxFeePerGas =
    feeData.maxFeePerGas ??
    (feeData.gasPrice
      ? feeData.gasPrice * 2n
      : maxPriorityFeePerGas * 2n);

  const feeWei = TRANSFER_GAS_LIMIT * maxFeePerGas;
  if (balanceWei === 0n) {
    throw new Error('ZERO_BALANCE');
  }
  if (balanceWei <= feeWei) {
    throw new Error(
      `잔액이 가스비보다 작아 전액 출금할 수 없습니다. balance=${balanceWei} fee=${feeWei}`,
    );
  }

  const valueWei = balanceWei - feeWei;
  const tx = Transaction.from({
    type: 2,
    to,
    value: valueWei,
    nonce,
    gasLimit: TRANSFER_GAS_LIMIT,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: network.chainId,
  });

  return { tx, balanceWei, feeWei, valueWei };
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
