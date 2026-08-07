import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ServiceTokenGuard } from '../auth/service-token.guard';
import { DkgService } from './dkg.service';
import { DkgMessagesDto, StartDkgDto } from './dto/dkg.dto';

@Controller('dkg')
@UseGuards(ServiceTokenGuard)
export class DkgController {
  constructor(private readonly dkg: DkgService) {}

  @Post('sessions')
  start(@Body() dto: StartDkgDto) {
    return this.dkg.start(dto);
  }

  @Post('sessions/:sessionId/round1')
  round1(@Param('sessionId') sessionId: string, @Body() dto: DkgMessagesDto) {
    return this.dkg.handleRound1(sessionId, dto.messages);
  }

  @Post('sessions/:sessionId/p2p')
  p2p(@Param('sessionId') sessionId: string, @Body() dto: DkgMessagesDto) {
    return this.dkg.handleP2P(sessionId, dto.messages, dto.commitmentsB64);
  }

  @Post('sessions/:sessionId/broadcast')
  broadcast(
    @Param('sessionId') sessionId: string,
    @Body() dto: DkgMessagesDto,
  ) {
    return this.dkg.handleBroadcast(sessionId, dto.messages);
  }

  @Post('sessions/:sessionId/finalize')
  finalize(@Param('sessionId') sessionId: string) {
    return this.dkg.finalize(sessionId);
  }

  @Post('sessions/:sessionId/abort')
  abort(@Param('sessionId') sessionId: string) {
    return this.dkg.abort(sessionId);
  }
}
