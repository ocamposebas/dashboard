interface LoginAttemptState {
  count: number;
  resetAt: number;
  nextVerificationAt: number;
}

export interface LoginAttemptDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class LoginAttemptThrottle {
  private readonly attempts = new Map<string, LoginAttemptState>();

  constructor(
    private readonly failureLimit = 8,
    private readonly windowMs = 15 * 60_000,
    private readonly verificationCooldownMs = 10_000,
  ) {}

  private key(ip: string, identity: string): string {
    const normalizedIdentity = identity.trim().toLocaleLowerCase("en") || "<unknown>";
    return `${ip}\u0000${normalizedIdentity}`;
  }

  beforeAttempt(ip: string, identity: string, now = Date.now()): LoginAttemptDecision {
    const key = this.key(ip, identity);
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.resetAt <= now) {
      if (attempt) this.attempts.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (attempt.count < this.failureLimit || attempt.nextVerificationAt <= now) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((attempt.nextVerificationAt - now) / 1_000)),
    };
  }

  recordFailure(ip: string, identity: string, now = Date.now()): LoginAttemptDecision {
    const key = this.key(ip, identity);
    const previous = this.attempts.get(key);
    const attempt = previous && previous.resetAt > now
      ? previous
      : { count: 0, resetAt: now + this.windowMs, nextVerificationAt: 0 };
    attempt.count += 1;
    if (attempt.count > this.failureLimit) {
      attempt.nextVerificationAt = now + this.verificationCooldownMs;
    }
    this.attempts.set(key, attempt);
    if (this.attempts.size > 2_000) {
      for (const [candidate, state] of this.attempts) {
        if (state.resetAt <= now) this.attempts.delete(candidate);
      }
    }
    return attempt.count > this.failureLimit
      ? { allowed: false, retryAfterSeconds: Math.ceil(this.verificationCooldownMs / 1_000) }
      : { allowed: true, retryAfterSeconds: 0 };
  }

  clear(ip: string, identity: string): void {
    this.attempts.delete(this.key(ip, identity));
  }
}
