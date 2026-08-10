import { parseEther } from 'ethers';
import { parseWithdrawAmountToWei } from './eth-transfer';

describe('parseWithdrawAmountToWei', () => {
  it('parses ETH decimal strings', () => {
    expect(parseWithdrawAmountToWei('0.01')).toBe(parseEther('0.01'));
    expect(parseWithdrawAmountToWei('1.0')).toBe(10n ** 18n);
  });

  it('parses pure wei integers without treating as ether', () => {
    expect(parseWithdrawAmountToWei('1000')).toBe(1000n);
    expect(parseWithdrawAmountToWei('1')).toBe(1n);
  });

  it('rejects empty / invalid', () => {
    expect(() => parseWithdrawAmountToWei('')).toThrow(/출금 금액/);
    expect(() => parseWithdrawAmountToWei('abc')).toThrow(/형식/);
  });
});
