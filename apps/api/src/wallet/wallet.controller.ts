import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';

@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: any) {
    return this.walletService.list(req.user.sub);
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  getSummary(@Req() req: any) {
    return this.walletService.getDashboardSummary(req.user.sub);
  }

  @Get(':id/balance')
  @UseGuards(JwtAuthGuard)
  getBalance(@Req() req: any, @Param('id') id: string) {
    return this.walletService.getBalance(req.user.sub, id);
  }

  @Get(':id/limits')
  @UseGuards(JwtAuthGuard)
  getLimits(@Req() req: any, @Param('id') id: string) {
    return this.walletService.getLimits(req.user.sub, id);
  }

  @Get(':id/withdraws')
  @UseGuards(JwtAuthGuard)
  getWithdrawHistory(
    @Req() req: any,
    @Param('id') id: string,
    @Query('status')
    status?:
      | 'PENDING'
      | 'APPROVED'
      | 'QUEUED'
      | 'PROCESSING'
      | 'EXECUTED'
      | 'REJECTED'
      | 'FAILED'
      | 'EXPIRED',
  ) {
    return this.walletService.getWithdrawHistory(req.user.sub, id, status);
  }
}
