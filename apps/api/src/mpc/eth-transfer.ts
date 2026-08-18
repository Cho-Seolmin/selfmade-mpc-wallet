import {
  Contract,
  Interface,
  getAddress,
  getBytes,
  hexlify,
  parseEther,
  Signature,
  Transaction,
  type Provider,
} from 'ethers';
import { SEPOLIA_CHAIN_ID } from '@selfmade/mpc-crypto';
import type { MpcEcdsaSignature } from './index';

const TRANSFER_GAS_LIMIT = 21_000n;
const ERC20_TRANSFER_GAS_FALLBACK = 100_000n;
const ERC20_TRANSFER_IFACE = new Interface([
  'function transfer(address to, uint256 amount)',
  'function balanceOf(address owner) view returns (uint256)',
]);

export type PreparedFullBalanceTransfer = {
  tx: Transaction;
  balanceWei: bigint;
  feeWei: bigint;
  valueWei: bigint;
};

export type PreparedAmountTransfer = PreparedFullBalanceTransfer;
export type WithdrawAsset = 'ETH' | 'ERC20';

function resolveFees(
  feeData: {
    maxPriorityFeePerGas: bigint | null;
    maxFeePerGas: bigint | null;
    gasPrice: bigint | null;
  },
  gasLimit: bigint,
): { maxPriorityFeePerGas: bigint; maxFeePerGas: bigint; feeWei: bigint } {
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
    feeWei: gasLimit * maxFeePerGas,
  };
}

function assertSepolia(chainId: bigint): void {
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `이 지갑은 Sepolia만 지원합니다. chainId=${chainId.toString()}`,
    );
  }
}

/** Canonical hex for tx.data so empty / `0x` / mixed-case compare equal. */
export function normalizeTxData(data?: string | null): string {
  const trimmed = (data ?? '').trim();
  if (!trimmed || /^0x$/i.test(trimmed)) return '0x';
  if (!/^0x[0-9a-fA-F]*$/i.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new Error('tx.data가 유효한 hex가 아닙니다.');
  }
  return `0x${trimmed.slice(2).toLowerCase()}`;
}

function eip1559Transfer(params: {
  to: string;
  value: bigint;
  nonce: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  chainId: bigint;
  data?: string;
  gasLimit?: bigint;
}): Transaction {
  return Transaction.from({
    type: 2,
    to: params.to,
    value: params.value,
    nonce: params.nonce,
    gasLimit: params.gasLimit ?? TRANSFER_GAS_LIMIT,
    maxFeePerGas: params.maxFeePerGas,
    maxPriorityFeePerGas: params.maxPriorityFeePerGas,
    chainId: params.chainId,
    data: normalizeTxData(params.data),
  });
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
  const fees = resolveFees(
    await params.provider.getFeeData(),
    TRANSFER_GAS_LIMIT,
  );

  if (balanceWei === 0n) {
    throw new Error('ZERO_BALANCE');
  }
  if (balanceWei <= fees.feeWei) {
    throw new Error(
      `잔액이 가스비보다 작아 전액 출금할 수 없습니다. balance=${balanceWei} fee=${fees.feeWei}`,
    );
  }

  const valueWei = balanceWei - fees.feeWei;
  assertSepolia(network.chainId);
  const tx = eip1559Transfer({
    to,
    value: valueWei,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    chainId: network.chainId,
    data: '0x',
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
  const fees = resolveFees(await params.provider.getFeeData(), TRANSFER_GAS_LIMIT);

  if (balanceWei < params.amountWei + fees.feeWei) {
    throw new Error(
      `잔액이 부족합니다. 필요≈${params.amountWei + fees.feeWei} wei (금액+가스), 잔액=${balanceWei} wei`,
    );
  }

  assertSepolia(network.chainId);
  const tx = eip1559Transfer({
    to,
    value: params.amountWei,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    chainId: network.chainId,
    data: '0x',
  });

  return {
    tx,
    balanceWei,
    feeWei: fees.feeWei,
    valueWei: params.amountWei,
  };
}

export function parseWithdrawAsset(raw?: string | null): WithdrawAsset {
  const value = (raw ?? 'ETH').trim().toUpperCase();
  if (value === '' || value === 'ETH') return 'ETH';
  if (value === 'ERC20') return 'ERC20';
  throw new Error('asset는 ETH 또는 ERC20 이어야 합니다.');
}

export function encodeErc20Transfer(to: string, amount: bigint): string {
  return normalizeTxData(
    ERC20_TRANSFER_IFACE.encodeFunctionData('transfer', [
      getAddress(to),
      amount,
    ]),
  );
}

export function isInsufficientGasError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : String((err as { message?: unknown })?.message ?? err ?? '');
  return msg === 'INSUFFICIENT_GAS' || msg.startsWith('INSUFFICIENT_GAS');
}

/**
 * Build an EIP-1559 ERC-20 transfer (tx.to = token, value = 0, data = transfer).
 * ETH is only used for gas. `amountRaw` is token units (18 decimals for TTK).
 */
export async function prepareErc20AmountTransfer(params: {
  provider: Provider;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
  tokenAddress: string;
}): Promise<PreparedAmountTransfer> {
  const from = getAddress(params.fromAddress);
  const recipient = getAddress(params.toAddress);
  const token = getAddress(params.tokenAddress);
  if (from === recipient) {
    throw new Error('수신 주소가 출금 지갑과 같을 수 없습니다.');
  }
  if (recipient === token) {
    throw new Error('수신 주소가 토큰 컨트랙트일 수 없습니다.');
  }
  if (params.amountRaw <= 0n) {
    throw new Error('출금 금액은 0보다 커야 합니다.');
  }

  const network = await params.provider.getNetwork();
  assertSepolia(network.chainId);

  const code = await params.provider.getCode(token);
  if (!code || code === '0x') {
    throw new Error('토큰 컨트랙트를 찾을 수 없습니다.');
  }

  const data = encodeErc20Transfer(recipient, params.amountRaw);
  const tokenContract = new Contract(
    token,
    ERC20_TRANSFER_IFACE,
    params.provider,
  );
  const tokenBalance = (await tokenContract.balanceOf(from)) as bigint;
  if (tokenBalance < params.amountRaw) {
    throw new Error(
      `토큰 잔액이 부족합니다. 필요=${params.amountRaw} 잔액=${tokenBalance}`,
    );
  }

  let gasLimit = ERC20_TRANSFER_GAS_FALLBACK;
  try {
    const estimated = await params.provider.estimateGas({
      from,
      to: token,
      data,
      value: 0n,
    });
    const padded = (estimated * 12n) / 10n;
    if (padded > TRANSFER_GAS_LIMIT) gasLimit = padded;
  } catch {
    // keep fallback
  }

  const ethBalance = await params.provider.getBalance(from);
  const nonce = await params.provider.getTransactionCount(from, 'pending');
  const fees = resolveFees(await params.provider.getFeeData(), gasLimit);
  if (ethBalance < fees.feeWei) {
    throw new Error('INSUFFICIENT_GAS');
  }

  const tx = eip1559Transfer({
    to: token,
    value: 0n,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    chainId: network.chainId,
    data,
    gasLimit,
  });

  return {
    tx,
    balanceWei: ethBalance,
    feeWei: fees.feeWei,
    valueWei: 0n,
  };
}

/**
 * Sweep the full ERC-20 balance. Throws ZERO_TOKEN_BALANCE when amount is 0.
 */
export async function prepareErc20FullBalanceTransfer(params: {
  provider: Provider;
  fromAddress: string;
  toAddress: string;
  tokenAddress: string;
}): Promise<PreparedAmountTransfer & { tokenAmount: bigint }> {
  const from = getAddress(params.fromAddress);
  const token = getAddress(params.tokenAddress);
  const tokenContract = new Contract(
    token,
    ERC20_TRANSFER_IFACE,
    params.provider,
  );
  const tokenAmount = (await tokenContract.balanceOf(from)) as bigint;
  if (tokenAmount === 0n) {
    throw new Error('ZERO_TOKEN_BALANCE');
  }
  const prepared = await prepareErc20AmountTransfer({
    ...params,
    amountRaw: tokenAmount,
  });
  return { ...prepared, tokenAmount };
}

/** Parse user amount as ETH decimal (e.g. "1" = 1 ETH, "0.01" = 0.01 ETH). */
export function parseWithdrawAmountToWei(amount: string): bigint {
  const trimmed = amount.trim();
  if (!trimmed) {
    throw new Error('출금 금액을 입력하세요.');
  }
  try {
    const wei = parseEther(trimmed);
    if (wei <= 0n) {
      throw new Error('출금 금액은 0보다 커야 합니다.');
    }
    return wei;
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('0보다')) {
      throw err;
    }
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

/** Local keccak hash of a signed raw tx (does not require RPC). */
export function signedRawTxHash(raw: string): string {
  const parsed = Transaction.from(raw);
  if (!parsed.hash) {
    throw new Error('signed tx hash missing');
  }
  return parsed.hash;
}

export function txFieldsForStorage(tx: Transaction): {
  to: string;
  value: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  chainId: string;
  data: string;
} {
  if (!tx.to) {
    throw new Error('tx.to is required');
  }
  if (tx.maxFeePerGas == null || tx.maxPriorityFeePerGas == null) {
    throw new Error('EIP-1559 fees are required');
  }
  return {
    to: tx.to,
    value: tx.value.toString(),
    nonce: tx.nonce,
    gasLimit: tx.gasLimit.toString(),
    maxFeePerGas: tx.maxFeePerGas.toString(),
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString(),
    chainId: tx.chainId.toString(),
    data: normalizeTxData(tx.data),
  };
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
  data?: string;
}): Transaction {
  const chainId = BigInt(fields.chainId);
  assertSepolia(chainId);
  return Transaction.from({
    type: 2,
    to: fields.to,
    value: BigInt(fields.value),
    nonce: fields.nonce,
    gasLimit: BigInt(fields.gasLimit),
    maxFeePerGas: BigInt(fields.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(fields.maxPriorityFeePerGas),
    chainId,
    data: normalizeTxData(fields.data),
  });
}
