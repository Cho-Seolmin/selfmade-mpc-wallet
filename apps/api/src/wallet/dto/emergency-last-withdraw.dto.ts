import { IsEthereumAddress, Matches } from 'class-validator';

export class EmergencyLastWithdrawDto {
  /** Destination for the full wallet balance (minus gas). */
  @IsEthereumAddress()
  toAddress!: string;

  /** Fresh Google OTP confirmation before B+C signing. */
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit code' })
  otp!: string;
}
