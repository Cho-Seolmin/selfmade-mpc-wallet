/**
 * In-memory OTP failure / lockout tracker (portfolio-simple).
 * Keyed by userId — never stores the OTP value itself.
 */
export class OtpFailureTracker {
  private readonly failures = new Map<
    string,
    { count: number; lockedUntilMs?: number }
  >();

  constructor(
    private readonly maxFailures = 5,
    private readonly lockMs = 15 * 60 * 1000,
  ) {}

  /** Throws if the user is currently locked out. */
  assertNotLocked(userId: string, now = Date.now()): void {
    const state = this.failures.get(userId);
    if (!state?.lockedUntilMs) return;
    if (now < state.lockedUntilMs) {
      const seconds = Math.ceil((state.lockedUntilMs - now) / 1000);
      throw new Error(`OTP_LOCKED:${seconds}`);
    }
    // Lock expired — reset.
    this.failures.delete(userId);
  }

  recordFailure(userId: string, now = Date.now()): {
    remainingAttempts: number;
    locked: boolean;
    lockSeconds?: number;
  } {
    const prev = this.failures.get(userId);
    const count = (prev?.count ?? 0) + 1;
    if (count >= this.maxFailures) {
      const lockedUntilMs = now + this.lockMs;
      this.failures.set(userId, { count, lockedUntilMs });
      return {
        remainingAttempts: 0,
        locked: true,
        lockSeconds: Math.ceil(this.lockMs / 1000),
      };
    }
    this.failures.set(userId, { count });
    return {
      remainingAttempts: this.maxFailures - count,
      locked: false,
    };
  }

  clear(userId: string): void {
    this.failures.delete(userId);
  }

  /** Test helper. */
  resetAll(): void {
    this.failures.clear();
  }
}
