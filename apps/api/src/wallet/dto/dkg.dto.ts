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

export class DkgStartDto {
  @ValidateNested()
  @Type(() => WireMessageDto)
  message!: WireMessageDto;
}

export class DkgRound2Dto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WireMessageDto)
  messages!: WireMessageDto[];

  @IsString()
  commitmentB64!: string;
}

export class DkgMessagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WireMessageDto)
  messages!: WireMessageDto[];
}
