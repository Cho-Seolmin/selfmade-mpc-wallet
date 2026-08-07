import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class WireMessageDto {
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

export class StartDkgDto {
  @IsString()
  sessionId!: string;

  @IsString()
  userId!: string;

  @IsString()
  walletId!: string;
}

export class DkgMessagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WireMessageDto)
  messages!: WireMessageDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  commitmentsB64?: string[];
}
