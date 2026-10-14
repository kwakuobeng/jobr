import { TokenBucket, RateLimitError } from "../ingestion/rate-limiter";
export { RateLimitError };
export class HostRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  constructor(
    private capacity = 10,
    private refillPerSecond = 5,
    private now: () => number = Date.now,
    private maxHosts = 1000,
  ) {
    if (
      ![capacity, refillPerSecond, maxHosts].every(
        (n) => Number.isFinite(n) && n > 0,
      )
    )
      throw new Error("Invalid rate limiter configuration");
  }
  take(hostname: string): void {
    const host = hostname.toLowerCase();
    let bucket = this.buckets.get(host);
    if (!bucket) {
      if (this.buckets.size >= this.maxHosts)
        throw new RateLimitError("Host rate limiter capacity reached");
      bucket = new TokenBucket(this.capacity, this.refillPerSecond, this.now);
      this.buckets.set(host, bucket);
    }
    bucket.take();
  }
}
export const hostRateLimiter = new HostRateLimiter();
