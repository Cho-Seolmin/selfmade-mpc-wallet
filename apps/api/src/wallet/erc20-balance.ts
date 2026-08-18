import { Contract, getAddress, type Provider } from 'ethers';

const ERC20_VIEW_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

export type Erc20BalanceItem = {
  address: string;
  symbol: string;
  decimals: number;
  balanceRaw: string;
};

export function getConfiguredTestTokenAddress(
  raw = process.env.SEPOLIA_TEST_TOKEN_ADDRESS,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
}

/**
 * Optional Sepolia ERC-20 balances for the MPC on-chain address.
 * Unset / invalid / RPC errors → empty list (ETH balance still works).
 */
export async function readConfiguredErc20Balances(
  provider: Provider,
  holder: string,
  tokenAddressRaw = process.env.SEPOLIA_TEST_TOKEN_ADDRESS,
): Promise<Erc20BalanceItem[]> {
  const tokenAddress = getConfiguredTestTokenAddress(tokenAddressRaw);
  if (!tokenAddress) return [];

  try {
    const token = new Contract(tokenAddress, ERC20_VIEW_ABI, provider);
    const [balance, symbol, decimals] = await Promise.all([
      token.balanceOf(holder) as Promise<bigint>,
      token.symbol() as Promise<string>,
      token.decimals() as Promise<bigint | number>,
    ]);
    return [
      {
        address: tokenAddress,
        symbol: String(symbol || 'TTK'),
        decimals: Number(decimals),
        balanceRaw: balance.toString(),
      },
    ];
  } catch {
    return [];
  }
}
