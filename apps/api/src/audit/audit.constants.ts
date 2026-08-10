import { AuditActorType } from '@prisma/client';

/** Canonical MPC / wallet lifecycle audit event names. */
export const AuditEventType = {
  MPC_WALLET_CREATED: 'MPC_WALLET_CREATED',
  RECOVERY_FILE_CREATED: 'RECOVERY_FILE_CREATED',
  BROWSER_SHARE_RECOVERED: 'BROWSER_SHARE_RECOVERED',
  WITHDRAW_REQUESTED: 'WITHDRAW_REQUESTED',
  WITHDRAW_COMPLETED: 'WITHDRAW_COMPLETED',
  EMERGENCY_OTP_FAILED: 'EMERGENCY_OTP_FAILED',
  EMERGENCY_RECOVERY_STARTED: 'EMERGENCY_RECOVERY_STARTED',
  EMERGENCY_RECOVERY_CANCELLED: 'EMERGENCY_RECOVERY_CANCELLED',
  EMERGENCY_WITHDRAW_REQUESTED: 'EMERGENCY_WITHDRAW_REQUESTED',
  EMERGENCY_WITHDRAW_COMPLETED: 'EMERGENCY_WITHDRAW_COMPLETED',
  EMERGENCY_WITHDRAW_FAILED: 'EMERGENCY_WITHDRAW_FAILED',
  WALLET_RETIRED: 'WALLET_RETIRED',
} as const;

export type AuditEventTypeName =
  (typeof AuditEventType)[keyof typeof AuditEventType];

/** Events the browser may report (never include share/PIN material). */
export const CLIENT_REPORTABLE_AUDIT_EVENTS = [
  AuditEventType.RECOVERY_FILE_CREATED,
  AuditEventType.BROWSER_SHARE_RECOVERED,
] as const;

export type ClientReportableAuditEvent =
  (typeof CLIENT_REPORTABLE_AUDIT_EVENTS)[number];

export type WriteAuditInput = {
  walletId: string;
  userId?: string | null;
  eventType: AuditEventTypeName | string;
  actorType?: AuditActorType;
  actorId?: string | null;
  message?: string;
  data?: Record<string, unknown>;
  withdrawRequestId?: string | null;
};
