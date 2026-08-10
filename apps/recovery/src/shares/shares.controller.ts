import {
  Controller,
  Get,
  Param,
  Post,
  Put,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ServiceTokenGuard } from '../auth/service-token.guard';
import { UpsertShareCDto } from './dto/upsert-share-c.dto';
import { SharesService } from './shares.service';

@Controller('shares')
@UseGuards(ServiceTokenGuard)
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  /** Store Share C after DKG (Main API → Recovery). */
  @Put()
  upsert(@Body() dto: UpsertShareCDto) {
    return this.shares.upsertShareC(dto);
  }

  /** Safe metadata (no share material). */
  @Get(':walletId')
  getMeta(@Param('walletId') walletId: string) {
    return this.shares.getShareMeta(walletId);
  }

  /** Mark Share C retired and wipe ciphertext after last withdraw. */
  @Post(':walletId/retire')
  retire(@Param('walletId') walletId: string) {
    return this.shares.retireShare(walletId);
  }
}
