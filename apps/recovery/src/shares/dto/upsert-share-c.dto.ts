import { IsInt, IsOptional, IsString, Matches, Min, Max } from 'class-validator';

export class UpsertShareCDto {
  @IsString()
  walletId!: string;

  @IsString()
  userId!: string;

  /** Compressed SEC1 public key hex (0x...). */
  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/, {
    message: 'mpcPublicKey must be 0x-prefixed hex',
  })
  mpcPublicKey!: string;

  /**
   * Opaque Share C bytes as base64 (plaintext over TLS + service token only).
   * Recovery encrypts at rest with RECOVERY_ENCRYPTION_KEY.
   */
  @IsString()
  shareCBase64!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  partyId?: number;
}
