import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CLIENT_REPORTABLE_AUDIT_EVENTS,
  type ClientReportableAuditEvent,
} from '../../audit/audit.constants';

export class ClientAuditEventDto {
  @IsIn([...CLIENT_REPORTABLE_AUDIT_EVENTS])
  eventType!: ClientReportableAuditEvent;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;

  /** Non-sensitive metadata only (sanitized server-side). */
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
