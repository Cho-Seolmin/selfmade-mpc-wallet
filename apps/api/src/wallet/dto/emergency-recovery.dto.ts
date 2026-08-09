import { Matches } from 'class-validator';

export class EmergencyStartDto {
  /** Google Authenticator TOTP (6 digits). */
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit code' })
  otp!: string;
}
