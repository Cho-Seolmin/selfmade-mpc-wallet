import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

type WireMessage = {
  from: number;
  to?: number;
  payloadB64: string;
};

@Injectable()
export class RecoveryClientService {
  private readonly logger = new Logger(RecoveryClientService.name);

  private baseUrl(): string {
    const url = process.env.RECOVERY_BASE_URL?.trim();
    if (!url) {
      throw new ServiceUnavailableException('RECOVERY_BASE_URL is not configured');
    }
    return url.replace(/\/$/, '');
  }

  private token(): string {
    const token = process.env.RECOVERY_SERVICE_TOKEN?.trim();
    if (!token) {
      throw new ServiceUnavailableException(
        'RECOVERY_SERVICE_TOKEN is not configured',
      );
    }
    return token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token()}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      this.logger.error(`Recovery request failed: ${method} ${path}`);
      throw new ServiceUnavailableException(
        'Recovery Server is unreachable',
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Recovery ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException(
        `Recovery Server error (${res.status})`,
      );
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  startDkg(params: {
    sessionId: string;
    userId: string;
    walletId: string;
  }) {
    return this.request<{ message: WireMessage }>('POST', '/dkg/sessions', params);
  }

  dkgRound1(sessionId: string, messages: WireMessage[]) {
    return this.request<{ messages: WireMessage[]; commitmentB64: string }>(
      'POST',
      `/dkg/sessions/${sessionId}/round1`,
      { messages },
    );
  }

  dkgP2P(
    sessionId: string,
    messages: WireMessage[],
    commitmentsB64?: string[],
  ) {
    return this.request<{ messages: WireMessage[] }>(
      'POST',
      `/dkg/sessions/${sessionId}/p2p`,
      { messages, commitmentsB64 },
    );
  }

  dkgBroadcast(sessionId: string, messages: WireMessage[]) {
    return this.request<{ ok: true }>(
      'POST',
      `/dkg/sessions/${sessionId}/broadcast`,
      { messages },
    );
  }

  dkgFinalize(sessionId: string) {
    return this.request<{
      walletId: string;
      partyId: number;
      mpcPublicKey: string;
    }>('POST', `/dkg/sessions/${sessionId}/finalize`);
  }

  dkgAbort(sessionId: string) {
    return this.request<{ ok: true }>(
      'POST',
      `/dkg/sessions/${sessionId}/abort`,
    ).catch(() => ({ ok: true as const }));
  }

  /**
   * Start party C SignSession on Recovery (Share C never exported).
   */
  signStart(params: { walletId: string; digestB64: string }) {
    return this.request<{
      sessionId: string;
      walletId: string;
      partyId: number;
      msg1C: WireMessage;
    }>('POST', '/sign/sessions', params);
  }

  signRound1(sessionId: string, messages: WireMessage[]) {
    return this.request<{ sessionId: string; messages: WireMessage[] }>(
      'POST',
      `/sign/sessions/${sessionId}/round1`,
      { messages },
    );
  }

  signRound2(sessionId: string, messages: WireMessage[]) {
    return this.request<{ sessionId: string; messages: WireMessage[] }>(
      'POST',
      `/sign/sessions/${sessionId}/round2`,
      { messages },
    );
  }

  signRound3(sessionId: string, messages: WireMessage[]) {
    return this.request<{ sessionId: string; ok: true }>(
      'POST',
      `/sign/sessions/${sessionId}/round3`,
      { messages },
    );
  }

  signLast(sessionId: string) {
    return this.request<{ sessionId: string; messages: WireMessage[] }>(
      'POST',
      `/sign/sessions/${sessionId}/last`,
    );
  }

  signAbort(sessionId: string) {
    return this.request<{ ok: true }>(
      'POST',
      `/sign/sessions/${sessionId}/abort`,
    ).catch(() => ({ ok: true as const }));
  }

  /** Wipe Share C after successful last withdraw. */
  retireShareC(walletId: string) {
    return this.request<{
      walletId: string;
      status: string;
      retiredAt: string | null;
    }>('POST', `/shares/${walletId}/retire`);
  }
}
