import { describe, it, expect, vi } from "vitest";
import {
  assertPublicAddress,
  validateUrl,
  guardedLookup,
  createSafeClient,
  SSRFBlockedError,
} from "@/lib/ingestion/ssrf-client";
import type { LookupFunction } from "node:net";
import { TokenBucket, RateLimitError } from "@/lib/ingestion/rate-limiter";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
const lookup = (
  fn: LookupFunction,
  options: Parameters<LookupFunction>[1] = {},
) =>
  new Promise<unknown>((resolve, reject) =>
    fn("board.example.com", options, (error, address, family) =>
      error ? reject(error) : resolve({ address, family }),
    ),
  );
describe("SSRF socket guard", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.2",
    "172.16.0.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "bad",
  ])("blocks %s", (ip) =>
    expect(() => assertPublicAddress(ip)).toThrow(SSRFBlockedError),
  );
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public %s",
    (ip) => expect(() => assertPublicAddress(ip)).not.toThrow(),
  );
  it.each([
    "http://example.com",
    "file:///etc/passwd",
    "https://a:b@example.com",
    "https://example.com:8443",
    "https://localhost",
    "https://a.local",
    "https://example.com.",
    "https://127.1",
    "https://2130706433",
    "https://[::1]",
  ])("rejects URL %s", (url) => expect(() => validateUrl(url)).toThrow());
  it("enforces exact host allowlist", () => {
    expect(() =>
      validateUrl("https://evil.example.com", ["example.com"]),
    ).toThrow();
    expect(validateUrl("https://example.com", ["example.com"]).host).toBe(
      "example.com",
    );
  });
  it("pins validated DNS address at the socket", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    expect(await lookup(guardedLookup(resolve))).toEqual({
      address: "8.8.8.8",
      family: 4,
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it("rejects mixed public and private DNS answers", async () => {
    await expect(
      lookup(
        guardedLookup(async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ]),
      ),
    ).rejects.toThrow(SSRFBlockedError);
  });
  it("rejects empty DNS and missing family", async () => {
    await expect(lookup(guardedLookup(async () => []))).rejects.toThrow();
    await expect(
      lookup(
        guardedLookup(async () => [{ address: "8.8.8.8", family: 4 }]),
        { family: 6 },
      ),
    ).rejects.toThrow();
  });
  it("supports all-address socket lookup", async () => {
    expect(
      await lookup(
        guardedLookup(async () => [{ address: "8.8.8.8", family: 4 }]),
        { all: true },
      ),
    ).toEqual({
      address: [{ address: "8.8.8.8", family: 4 }],
      family: undefined,
    });
  });
  it("propagates resolver errors", async () => {
    await expect(
      lookup(
        guardedLookup(async () => {
          throw new Error("DNS timeout");
        }),
      ),
    ).rejects.toThrow("DNS timeout");
  });
  it("blocks before any request", async () => {
    await expect(createSafeClient()("https://10.0.0.1")).rejects.toThrow();
  });
  it("global dispatcher cannot replace socket guard", async () => {
    const previous = getGlobalDispatcher(),
      mock = new MockAgent();
    mock.disableNetConnect();
    setGlobalDispatcher(mock);
    try {
      await expect(
        createSafeClient(["example.com"])("https://127.0.0.1"),
      ).rejects.toThrow();
    } finally {
      setGlobalDispatcher(previous);
      await mock.close();
    }
  });
});
describe("rate limiter", () => {
  it("limits bursts, refills, and caps tokens", () => {
    let now = 0;
    const bucket = new TokenBucket(1, 1, () => now);
    bucket.take();
    expect(() => bucket.take()).toThrow(RateLimitError);
    now = 1000;
    bucket.take();
    now = 100_000;
    bucket.take();
    expect(() => bucket.take()).toThrow();
  });
  it("rejects invalid settings", () => {
    expect(() => new TokenBucket(0)).toThrow();
    expect(() => new TokenBucket(1, 0)).toThrow();
  });
});

describe("createSafeClient injected resolver", () => {
  it("still blocks private addresses returned by an injected resolver", async () => {
    const client = createSafeClient(["example.com"], {
      resolve: async () => [{ address: "10.0.0.5", family: 4 }],
    });
    const err: unknown = await client("https://example.com/x").catch((e: unknown) => e);
    const chain = [err, (err as { cause?: unknown })?.cause].map((e) => (e instanceof Error ? e.message : ""));
    expect(chain.some((m) => /Non-public IP address/.test(m))).toBe(true);
  });
  it("still enforces the host allowlist with an injected resolver", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const client = createSafeClient(["example.com"], { resolve });
    await expect(client("https://evil.example.net/x")).rejects.toThrow("Host is not allowlisted");
    expect(resolve).not.toHaveBeenCalled();
  });
});
