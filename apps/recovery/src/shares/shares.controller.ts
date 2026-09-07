import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ServiceTokenGuard } from '../auth/service-token.guard';
import { SharesService } from './shares.service';

@Controller('shares')
@UseGuards(ServiceTokenGuard)
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  /** Safe metadata (no share material). Share C is created only by DKG finalize. */
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
