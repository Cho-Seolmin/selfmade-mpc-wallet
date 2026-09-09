import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

type WithdrawUpdatedPayload = {
  withdrawRequestId: string;
  walletId: string;
  walletType?: string;
  status: string;
  txHash?: string | null;
  message?: string;
};

function extractAccessTokenFromSocket(client: Socket): string | null {
  const cookieHeader = client.handshake.headers.cookie;
  if (typeof cookieHeader === 'string') {
    for (const part of cookieHeader.split(';')) {
      const [rawKey, ...rawValue] = part.trim().split('=');
      if (rawKey === 'accessToken' && rawValue.length > 0) {
        return decodeURIComponent(rawValue.join('='));
      }
    }
  }

  const authToken = client.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken;
  }

  const authHeader = client.handshake.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }

  return null;
}

function isBlockedJwtType(type?: string): boolean {
  if (!type) return false;
  return type !== 'access';
}

function getFrontendOrigin(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173';
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: getFrontendOrigin(),
    credentials: true,
  },
})
export class WithdrawGateway implements OnGatewayConnection {
  private readonly logger = new Logger(WithdrawGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = extractAccessTokenFromSocket(client);
      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = this.jwt.verify(token);

      if (payload.type === 'verify-email' || isBlockedJwtType(payload.type)) {
        client.disconnect(true);
        return;
      }

      if (!payload.sub) {
        client.disconnect(true);
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, status: true, tokenVersion: true },
      });

      if (!user || user.status !== 'ACTIVE') {
        client.disconnect(true);
        return;
      }

      const tokenVersion =
        typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 0;
      if (tokenVersion !== user.tokenVersion) {
        client.disconnect(true);
        return;
      }

      client.data.userId = user.id;
      client.join(`user:${user.id}`);
    } catch (error) {
      this.logger.warn(`WebSocket authentication failed: ${String(error)}`);
      client.disconnect(true);
    }
  }

  emitWithdrawUpdated(payload: WithdrawUpdatedPayload & { userId: string }) {
    const { userId, ...event } = payload;
    this.server.to(`user:${userId}`).emit('withdraw.updated', event);
  }
}
