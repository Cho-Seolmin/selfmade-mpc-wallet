import { readConfiguredErc20Balances } from './erc20-balance';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    Contract: jest.fn(),
  };
});

import { Contract } from 'ethers';

const ContractMock = Contract as unknown as jest.Mock;

describe('readConfiguredErc20Balances', () => {
  const holder = '0x1111111111111111111111111111111111111111';
  const token = '0xc3CF22f1a32f360B685C56Da48481007d580cDb4';

  beforeEach(() => {
    ContractMock.mockReset();
  });

  it('returns empty when token address is unset', async () => {
    const rows = await readConfiguredErc20Balances({} as any, holder, '');
    expect(rows).toEqual([]);
    expect(ContractMock).not.toHaveBeenCalled();
  });

  it('returns empty when token address is invalid', async () => {
    const rows = await readConfiguredErc20Balances(
      {} as any,
      holder,
      'not-an-address',
    );
    expect(rows).toEqual([]);
  });

  it('reads balanceOf / symbol / decimals', async () => {
    ContractMock.mockImplementation(() => ({
      balanceOf: jest.fn().mockResolvedValue(10_000n * 10n ** 18n),
      symbol: jest.fn().mockResolvedValue('TTK'),
      decimals: jest.fn().mockResolvedValue(18),
    }));

    const rows = await readConfiguredErc20Balances({} as any, holder, token);
    expect(rows).toEqual([
      {
        address: token,
        symbol: 'TTK',
        decimals: 18,
        balanceRaw: (10_000n * 10n ** 18n).toString(),
      },
    ]);
  });

  it('returns empty when RPC read fails', async () => {
    ContractMock.mockImplementation(() => ({
      balanceOf: jest.fn().mockRejectedValue(new Error('rpc down')),
      symbol: jest.fn().mockResolvedValue('TTK'),
      decimals: jest.fn().mockResolvedValue(18),
    }));

    const rows = await readConfiguredErc20Balances({} as any, holder, token);
    expect(rows).toEqual([]);
  });
});
