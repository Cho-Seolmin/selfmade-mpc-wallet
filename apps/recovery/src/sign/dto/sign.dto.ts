import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SignWireMessageDto {
  @IsString()
  payloadB64!: string;

  @IsInt()
  @Min(0)
  from!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  to?: number;
}

export class SignStartDto {
  @IsString()
  @MinLength(1)
  walletId!: string;

  /** 32-byte tx digest, base64. */
  @IsString()
  @MinLength(1)
  digestB64!: string;
}

export class SignMessagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SignWireMessageDto)
  messages!: SignWireMessageDto[];
}
