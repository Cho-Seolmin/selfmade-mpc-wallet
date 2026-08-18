import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
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

  /** Decimal amount ("1" = 1 ETH or 1 TTK). */
  @IsString()
  @MinLength(1)
  amount!: string;

  @IsOptional()
  @IsIn(['ETH', 'ERC20'])
  asset?: 'ETH' | 'ERC20';
}

export class SignMessagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WireMessageDto)
  messages!: WireMessageDto[];
}
