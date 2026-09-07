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
   * Opaque Share C bytes as base64. In-process persist only (tests / helpers).
   * HTTP has no import path — production Share C is created by DKG finalize.
   */
  @IsString()
  shareCBase64!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  partyId?: number;
}
