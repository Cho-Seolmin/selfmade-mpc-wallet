/** Stable machine-readable codes for MPC / wallet lifecycle errors. */
export const MpcErrorCode = {
  WALLET_RETIRED: 'WALLET_RETIRED',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  OTP_INVALID: 'OTP_INVALID',
  OTP_LOCKED: 'OTP_LOCKED',
  OTP_FORMAT: 'OTP_FORMAT',
  EMERGENCY_STATE_INVALID: 'EMERGENCY_STATE_INVALID',
  EMERGENCY_WITHDRAW_FAILED: 'EMERGENCY_WITHDRAW_FAILED',
  SHARE_B_MISSING: 'SHARE_B_MISSING',
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  LIVE_WALLET_EXISTS: 'LIVE_WALLET_EXISTS',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;

export type MpcErrorCodeName =
  (typeof MpcErrorCode)[keyof typeof MpcErrorCode];

export type MpcErrorBody = {
  message: string;
  code: MpcErrorCodeName;
};
