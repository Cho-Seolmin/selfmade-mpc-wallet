import { OtpFailureTracker } from './otp-failure-tracker';

describe('OtpFailureTracker', () => {
  it('locks after max failures and clears on success path', () => {
    const tracker = new OtpFailureTracker(3, 60_000);
    const now = 1_000_000;

    expect(tracker.recordFailure('u1', now)).toEqual({
      remainingAttempts: 2,
      locked: false,
    });
    expect(tracker.recordFailure('u1', now)).toEqual({
      remainingAttempts: 1,
      locked: false,
    });
    expect(tracker.recordFailure('u1', now)).toEqual({
      remainingAttempts: 0,
      locked: true,
      lockSeconds: 60,
    });

    expect(() => tracker.assertNotLocked('u1', now + 1_000)).toThrow(
      /OTP_LOCKED:59/,
    );

    // After lock expiry, assert clears state.
    tracker.assertNotLocked('u1', now + 60_001);
    expect(() => tracker.assertNotLocked('u1', now + 60_002)).not.toThrow();
  });

  it('clear resets failure count', () => {
    const tracker = new OtpFailureTracker(5, 60_000);
    tracker.recordFailure('u1');
    tracker.recordFailure('u1');
    tracker.clear('u1');
    expect(tracker.recordFailure('u1').remainingAttempts).toBe(4);
  });
});
