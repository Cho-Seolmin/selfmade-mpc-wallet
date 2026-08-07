import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DkgOrchestratorService } from '../mpc/dkg-orchestrator.service';
import { DkgMessagesDto, DkgRound2Dto, DkgStartDto } from './dto/dkg.dto';
import { WalletService } from './wallet.service';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly dkg: DkgOrchestratorService,
  ) {}

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

  /** Start 2-of-3 DKG (browser sends party A round-1 message). */
  @Post('mpc/dkg/start')
  @UseGuards(JwtAuthGuard)
  dkgStart(@Req() req: any, @Body() dto: DkgStartDto) {
    return this.dkg.start(req.user.sub, dto.message);
  }

  @Post('mpc/dkg/:sessionId/round2')
  @UseGuards(JwtAuthGuard)
  dkgRound2(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: DkgRound2Dto,
  ) {
    return this.dkg.round2(
      req.user.sub,
      sessionId,
      dto.messages,
      dto.commitmentB64,
    );
  }

  @Post('mpc/dkg/:sessionId/round3')
  @UseGuards(JwtAuthGuard)
  dkgRound3(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: DkgMessagesDto,
  ) {
    return this.dkg.round3(req.user.sub, sessionId, dto.messages);
  }

  @Post('mpc/dkg/:sessionId/round4')
  @UseGuards(JwtAuthGuard)
  dkgRound4(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: DkgMessagesDto,
  ) {
    return this.dkg.round4(req.user.sub, sessionId, dto.messages);
  }

  @Post('mpc/dkg/:sessionId/complete')
  @UseGuards(JwtAuthGuard)
  dkgComplete(@Req() req: any, @Param('sessionId') sessionId: string) {
    return this.dkg.complete(req.user.sub, sessionId);
  }

  @Post('mpc/dkg/:sessionId/abort')
  @UseGuards(JwtAuthGuard)
  dkgAbort(@Req() req: any, @Param('sessionId') sessionId: string) {
    return this.dkg.abort(req.user.sub, sessionId);
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
