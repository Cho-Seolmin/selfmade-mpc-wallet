import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DkgOrchestratorService } from '../mpc/dkg-orchestrator.service';
import { SignOrchestratorService } from '../mpc/sign-orchestrator.service';
import { DkgMessagesDto, DkgRound2Dto, DkgStartDto } from './dto/dkg.dto';
import { ClientAuditEventDto } from './dto/client-audit-event.dto';
import { EmergencyLastWithdrawDto } from './dto/emergency-last-withdraw.dto';
import { EmergencyStartDto } from './dto/emergency-recovery.dto';
import { SignMessagesDto, SignStartDto } from './dto/sign.dto';
import { EmergencyLastWithdrawService } from './emergency-last-withdraw.service';
import { EmergencyRecoveryService } from './emergency-recovery.service';
import { WalletService } from './wallet.service';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly dkg: DkgOrchestratorService,
    private readonly sign: SignOrchestratorService,
    private readonly emergency: EmergencyRecoveryService,
    private readonly lastWithdraw: EmergencyLastWithdrawService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: any) {
    return this.walletService.list(req.user.sub);
  }

  /** Retired wallet history (metadata only). Must be registered before :id routes. */
  @Get('retired')
  @UseGuards(JwtAuthGuard)
  listRetired(@Req() req: any) {
    return this.walletService.listRetired(req.user.sub);
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  getSummary(@Req() req: any) {
    return this.walletService.getDashboardSummary(req.user.sub);
  }

  /** Start 2-of-3 DKG (browser sends party A round-1 message). */
  @Post('mpc/dkg/start')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

  /** Start normal A+B threshold signing for a partial ETH withdraw. */
  @Post('mpc/sign/start')
  @UseGuards(JwtAuthGuard)
  signStart(
    @Req() req: any,
    @Body() dto: SignStartDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.sign.start(
      req.user.sub,
      dto.walletId,
      dto.toAddress,
      dto.amount,
      idempotencyKey,
      dto.asset,
    );
  }

  @Post('mpc/sign/:sessionId/round1')
  @UseGuards(JwtAuthGuard)
  signRound1(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: SignMessagesDto,
  ) {
    return this.sign.round1(req.user.sub, sessionId, dto.messages);
  }

  @Post('mpc/sign/:sessionId/round2')
  @UseGuards(JwtAuthGuard)
  signRound2(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: SignMessagesDto,
  ) {
    return this.sign.round2(req.user.sub, sessionId, dto.messages);
  }

  @Post('mpc/sign/:sessionId/round3')
  @UseGuards(JwtAuthGuard)
  signRound3(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: SignMessagesDto,
  ) {
    return this.sign.round3(req.user.sub, sessionId, dto.messages);
  }

  @Post('mpc/sign/:sessionId/complete')
  @UseGuards(JwtAuthGuard)
  signComplete(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: SignMessagesDto,
  ) {
    return this.sign.complete(req.user.sub, sessionId, dto.messages);
  }

  @Post('mpc/sign/:sessionId/abort')
  @UseGuards(JwtAuthGuard)
  signAbort(@Req() req: any, @Param('sessionId') sessionId: string) {
    return this.sign.abort(req.user.sub, sessionId);
  }

  /**
   * Google OTP gate for emergency recovery (Recovery File lost).
   * Sets wallet to RECOVERY_PENDING. B+C last withdraw is a later step.
   */
  @Post(':id/emergency/start')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  startEmergency(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: EmergencyStartDto,
  ) {
    return this.emergency.startEmergencyRecovery(req.user.sub, id, dto.otp);
  }

  /**
   * Cancel accidental emergency/start: RECOVERY_PENDING → ACTIVE.
   * Not available after RETIRING.
   */
  @Post(':id/emergency/cancel')
  @UseGuards(JwtAuthGuard)
  cancelEmergency(@Req() req: any, @Param('id') id: string) {
    return this.emergency.cancelEmergencyRecovery(req.user.sub, id);
  }

  /**
   * B+C full-balance last withdraw after RECOVERY_PENDING.
   * Retires the wallet on success.
   */
  @Post(':id/emergency/last-withdraw')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  emergencyLastWithdraw(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: EmergencyLastWithdrawDto,
  ) {
    return this.lastWithdraw.executeLastWithdraw(
      req.user.sub,
      id,
      dto.toAddress,
      dto.otp,
    );
  }

  /** Browser-reported audit (Recovery File / Share restore). No secrets allowed. */
  @Post(':id/audit-events')
  @UseGuards(JwtAuthGuard)
  reportAuditEvent(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ClientAuditEventDto,
  ) {
    return this.walletService.reportClientAuditEvent(
      req.user.sub,
      id,
      dto.eventType,
      dto.message,
      dto.data,
    );
  }

  @Get(':id/audits')
  @UseGuards(JwtAuthGuard)
  listAudits(
    @Req() req: any,
    @Param('id') id: string,
    @Query('take') take?: string,
  ) {
    const n = take ? Number(take) : 50;
    return this.walletService.listAuditLogs(
      req.user.sub,
      id,
      Number.isFinite(n) ? n : 50,
    );
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
      | 'BROADCASTED'
      | 'EXECUTED'
      | 'REJECTED'
      | 'FAILED'
      | 'EXPIRED',
  ) {
    return this.walletService.getWithdrawHistory(req.user.sub, id, status);
  }
}
