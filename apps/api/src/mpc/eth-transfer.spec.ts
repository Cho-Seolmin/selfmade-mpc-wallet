import { parseEther, Transaction } from 'ethers';
import {
  encodeErc20Transfer,
  normalizeTxData,
  parseWithdrawAmountToWei,
  parseWithdrawAsset,
  prepareErc20AmountTransfer,
  prepareErc20FullBalanceTransfer,
  txFromStoredFields,
  unsignedTxDigest32,
} from './eth-transfer';

describe('parseWithdrawAmountToWei', () => {
  it('parses ETH decimal strings including whole ether', () => {
    expect(parseWithdrawAmountToWei('0.01')).toBe(parseEther('0.01'));
    expect(parseWithdrawAmountToWei('1.0')).toBe(10n ** 18n);
    expect(parseWithdrawAmountToWei('1')).toBe(10n ** 18n);
    expect(parseWithdrawAmountToWei('1000')).toBe(parseEther('1000'));
  });

  it('rejects empty / invalid / zero', () => {
    expect(() => parseWithdrawAmountToWei('')).toThrow(/출금 금액/);
    expect(() => parseWithdrawAmountToWei('abc')).toThrow(/형식/);
    expect(() => parseWithdrawAmountToWei('0')).toThrow(/0보다/);
  });
});

describe('tx data binding', () => {
  const base = {
    to: '0x2222222222222222222222222222222222222222',
    value: '0',
    nonce: 1,
    gasLimit: '21000',
    maxFeePerGas: '1',
    maxPriorityFeePerGas: '1',
    chainId: '11155111',
  };

  it('normalizes empty data to 0x', () => {
    expect(normalizeTxData(undefined)).toBe('0x');
    expect(normalizeTxData('0X')).toBe('0x');
  });

  it('includes data in the unsigned digest', () => {
    const empty = unsignedTxDigest32(txFromStoredFields(base));
    const withCalldata = unsignedTxDigest32(
      txFromStoredFields({
        ...base,
        data: '0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222',
      }),
    );
    expect(Buffer.from(empty).equals(Buffer.from(withCalldata))).toBe(false);
  });

  it('rejects non-Sepolia chainId', () => {
    expect(() =>
      txFromStoredFields({ ...base, chainId: '1' }),
    ).toThrow(/Sepolia/);
  });

  it('round-trips type-2 fields including data', () => {
    const data =
      '0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222';
    const tx = txFromStoredFields({ ...base, data });
    expect(tx.type).toBe(2);
    expect(tx.data).toBe(data);
    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe('parseWithdrawAsset', () => {
  it('defaults to ETH and accepts ERC20', () => {
    expect(parseWithdrawAsset(undefined)).toBe('ETH');
    expect(parseWithdrawAsset('ETH')).toBe('ETH');
    expect(parseWithdrawAsset('ERC20')).toBe('ERC20');
  });

  it('rejects unknown assets', () => {
    expect(() => parseWithdrawAsset('BTC')).toThrow(/ETH 또는 ERC20/);
  });
});

describe('encodeErc20Transfer', () => {
  it('encodes transfer(to, amount) calldata', () => {
    const to = '0x2222222222222222222222222222222222222222';
    const data = encodeErc20Transfer(to, 10n ** 15n);
    expect(data.startsWith('0xa9059cbb')).toBe(true);
    expect(data).toContain('2222222222222222222222222222222222222222');
  });
});

describe('prepareErc20AmountTransfer', () => {
  const token = '0xc3CF22f1a32f360B685C56Da48481007d580cDb4';
  const from = '0x1111111111111111111111111111111111111111';
  const recipient = '0x2222222222222222222222222222222222222222';

  it('builds value=0 transfer to the token contract', async () => {
    const amount = 10n ** 18n;
    const provider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 11155111n }),
      getBalance: jest.fn().mockResolvedValue(10n ** 18n),
      getTransactionCount: jest.fn().mockResolvedValue(3),
      getFeeData: jest.fn().mockResolvedValue({
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        gasPrice: 1n,
      }),
      getCode: jest.fn().mockResolvedValue('0x608060'),
      estimateGas: jest.fn().mockResolvedValue(65000n),
      call: jest.fn().mockResolvedValue(
        `0x${(10n ** 22n).toString(16).padStart(64, '0')}`,
      ),
    };

    const prepared = await prepareErc20AmountTransfer({
      provider: provider as any,
      fromAddress: from,
      toAddress: recipient,
      amountRaw: amount,
      tokenAddress: token,
    });

    expect(prepared.tx.to).toBe(token);
    expect(prepared.tx.value).toBe(0n);
    expect(prepared.tx.data).toBe(encodeErc20Transfer(recipient, amount));
    expect(prepared.valueWei).toBe(0n);
    expect(prepared.tx.gasLimit).toBe((65000n * 12n) / 10n);
  });

  it('throws INSUFFICIENT_GAS when ETH cannot cover token transfer gas', async () => {
    const provider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 11155111n }),
      getBalance: jest.fn().mockResolvedValue(1n),
      getTransactionCount: jest.fn().mockResolvedValue(3),
      getFeeData: jest.fn().mockResolvedValue({
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        gasPrice: 1_000_000_000n,
      }),
      getCode: jest.fn().mockResolvedValue('0x608060'),
      estimateGas: jest.fn().mockResolvedValue(65000n),
      call: jest.fn().mockResolvedValue(
        `0x${(10n ** 22n).toString(16).padStart(64, '0')}`,
      ),
    };

    await expect(
      prepareErc20AmountTransfer({
        provider: provider as any,
        fromAddress: from,
        toAddress: recipient,
        amountRaw: 10n ** 18n,
        tokenAddress: token,
      }),
    ).rejects.toThrow('INSUFFICIENT_GAS');
  });

  it('prepareErc20FullBalanceTransfer throws ZERO_TOKEN_BALANCE when empty', async () => {
    const provider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 11155111n }),
      call: jest.fn().mockResolvedValue(`0x${'0'.repeat(64)}`),
    };
    await expect(
      prepareErc20FullBalanceTransfer({
        provider: provider as any,
        fromAddress: from,
        toAddress: recipient,
        tokenAddress: token,
      }),
    ).rejects.toThrow('ZERO_TOKEN_BALANCE');
  });
});
