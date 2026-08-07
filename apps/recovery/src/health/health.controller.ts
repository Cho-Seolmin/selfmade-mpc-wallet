import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    let dbOk = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }

    return {
      status: dbOk ? 'OK' : 'DEGRADED',
      service: 'recovery',
      role: 'MPC_SHARE_C',
      dbConnected: dbOk,
      serverTime: new Date().toISOString(),
    };
  }
}
