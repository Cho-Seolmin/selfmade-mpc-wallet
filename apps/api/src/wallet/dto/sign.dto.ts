import { Type } from 'class-transformer';
import {
  IsArray,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { WireMessageDto } from './dkg.dto';

export class SignStartDto {
  @IsString()
  @MinLength(1)
  walletId!: string;

  @IsString()
  @MinLength(42)
  toAddress!: string;

  /** ETH decimal (e.g. "0.01") or wei integer string. */
  @IsString()
  @MinLength(1)
  amount!: string;
}

export class SignMessagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WireMessageDto)
  messages!: WireMessageDto[];
}
