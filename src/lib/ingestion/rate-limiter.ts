export class RateLimitError extends Error {}
// Fail-fast token bucket: callers retry in their durable job runner, without occupying a worker.
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private capacity = 5,
    private perSecond = 1,
    private now: () => number = Date.now,
  ) {
    if (capacity <= 0 || perSecond <= 0)
      throw new Error("Invalid token bucket settings");
    this.tokens = capacity;
    this.last = now();
  }
  take(): void {
    const current = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (Math.max(0, current - this.last) * this.perSecond) / 1000,
    );
    this.last = current;
    if (this.tokens < 1)
      throw new RateLimitError("Rate limit reached; retry later");
    this.tokens -= 1;
  }
}
