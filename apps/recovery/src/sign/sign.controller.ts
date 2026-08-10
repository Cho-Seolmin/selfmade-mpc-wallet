import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ServiceTokenGuard } from '../auth/service-token.guard';
import { SignMessagesDto, SignStartDto } from './dto/sign.dto';
import { SignService } from './sign.service';

/**
 * Party C threshold-sign rounds for emergency B+C.
 * Share C never appears in responses — wire messages only.
 */
@Controller('sign')
@UseGuards(ServiceTokenGuard)
export class SignController {
  constructor(private readonly sign: SignService) {}

  @Post('sessions')
  start(@Body() dto: SignStartDto) {
    return this.sign.start(dto.walletId, dto.digestB64);
  }

  @Post('sessions/:sessionId/round1')
  round1(
    @Param('sessionId') sessionId: string,
    @Body() dto: SignMessagesDto,
  ) {
    return this.sign.round1(sessionId, dto.messages);
  }

  @Post('sessions/:sessionId/round2')
  round2(
    @Param('sessionId') sessionId: string,
    @Body() dto: SignMessagesDto,
  ) {
    return this.sign.round2(sessionId, dto.messages);
  }

  @Post('sessions/:sessionId/round3')
  round3(
    @Param('sessionId') sessionId: string,
    @Body() dto: SignMessagesDto,
  ) {
    return this.sign.round3(sessionId, dto.messages);
  }

  @Post('sessions/:sessionId/last')
  last(@Param('sessionId') sessionId: string) {
    return this.sign.lastMessage(sessionId);
  }

  @Post('sessions/:sessionId/abort')
  abort(@Param('sessionId') sessionId: string) {
    return this.sign.abort(sessionId);
  }
}
