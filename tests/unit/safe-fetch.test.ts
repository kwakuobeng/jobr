import { beforeEach, describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  request: vi.fn(),
  destroy: vi.fn(),
  agent: vi.fn(),
}));
vi.mock("undici", () => ({
  Agent: class {
    constructor(options: unknown) {
      mock.agent(options);
    }
    destroy = mock.destroy;
  },
  request: mock.request,
}));
import { createSafeFetch, BodySizeError } from "@/lib/http/safe_fetch";
import { HostRateLimiter } from "@/lib/http/rate_limiter";
const resolve = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);
const make = () => createSafeFetch(resolve, { take: vi.fn() });
function response(
  status = 200,
  headers: Record<string, string> = {},
  chunks = ["ok"],
) {
  return {
    statusCode: status,
    headers,
    body: (async function* () {
      for (const c of chunks) yield Buffer.from(c);
    })(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  resolve.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mock.request.mockImplementation(async () => response());
});
describe("bounded GET transport and redirect DNS guards", () => {
  it.each([
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://169.254.169.254",
    "https://100.64.0.1",
    "https://0.0.0.0",
    "https://[::1]",
    "https://[fc00::1]",
    "https://[fe80::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:169.254.169.254]",
    "http://example.com",
    "file:///etc/passwd",
  ])("blocks %s before sending", async (url) => {
    await expect(make()(url)).rejects.toThrow();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("rejects DNS answer %s", async (address) => {
    resolve.mockResolvedValue([
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    await expect(make()("https://jobs.example.com")).rejects.toThrow();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it("blocks mixed, empty and failed DNS answers", async () => {
    resolve.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(make()("https://jobs.example.com")).rejects.toThrow();
    resolve.mockResolvedValue([]);
    await expect(make()("https://jobs.example.com")).rejects.toThrow(
      "no addresses",
    );
    resolve.mockRejectedValue(new Error("DNS failed"));
    await expect(make()("https://jobs.example.com")).rejects.toThrow(
      "DNS failed",
    );
  });
  it("returns bounded text and pins the validated address without a second lookup", async () => {
    const r = await make()("https://jobs.example.com/a");
    expect(r.text).toBe("ok");
    expect(resolve).toHaveBeenCalledTimes(1);
    const lookup = mock.agent.mock.calls[0]?.[0].connect.lookup;
    await new Promise<void>((done, reject) =>
      lookup("jobs.example.com", {}, (error: Error | null, address: string) => {
        if (error) reject(error);
        else {
          expect(address).toBe("8.8.8.8");
          done();
        }
      }),
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(mock.request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "GET",
        maxRedirections: 0,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mock.destroy).toHaveBeenCalled();
  });
  it("accepts a public literal without resolving DNS", async () => {
    expect((await make()("https://1.1.1.1")).status).toBe(200);
    expect(resolve).not.toHaveBeenCalled();
  });
  it("re-resolves and checks each relative redirect", async () => {
    mock.request
      .mockResolvedValueOnce(response(302, { location: "/b" }))
      .mockResolvedValueOnce(response(200));
    const r = await make()("https://jobs.example.com/a");
    expect(r.url).toBe("https://jobs.example.com/b");
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("blocks private, non-HTTPS, and disallowed redirect hosts", async () => {
    for (const target of [
      "https://127.0.0.1",
      "http://jobs.example.com",
      "https://other.example.com",
    ]) {
      mock.request.mockResolvedValueOnce(response(302, { location: target }));
      await expect(
        make()("https://jobs.example.com", {
          allowedHosts: ["jobs.example.com"],
        }),
      ).rejects.toThrow();
    }
  });
  it("blocks DNS rebinding on a later redirect", async () => {
    resolve
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    mock.request.mockResolvedValueOnce(response(302, { location: "/b" }));
    await expect(make()("https://jobs.example.com")).rejects.toThrow();
    expect(mock.request).toHaveBeenCalledTimes(1);
  });
  it("allows at most three redirects", async () => {
    mock.request.mockImplementation(async () =>
      response(302, { location: "/again" }),
    );
    await expect(make()("https://jobs.example.com")).rejects.toThrow(
      "Too many",
    );
    expect(mock.request).toHaveBeenCalledTimes(4);
  });
  it("rejects redirects without a location and honors zero redirects", async () => {
    mock.request.mockResolvedValueOnce(response(302));
    await expect(make()("https://jobs.example.com")).rejects.toThrow(
      "no location",
    );
    mock.request.mockResolvedValueOnce(response(302, { location: "/b" }));
    await expect(
      make()("https://jobs.example.com", { maxRedirects: 0 }),
    ).rejects.toThrow("Too many");
  });
  it("strips credentials when the origin changes", async () => {
    mock.request
      .mockResolvedValueOnce(
        response(307, { location: "https://other.example.com" }),
      )
      .mockResolvedValueOnce(response());
    await make()("https://jobs.example.com", {
      headers: {
        Authorization: "secret",
        "Authorization-Key": "key",
        Cookie: "cookie",
      },
    });
    expect(mock.request.mock.calls[1]?.[1].headers).toEqual({});
  });
  it("rejects declared, streamed and cumulative oversized bodies", async () => {
    mock.request.mockResolvedValueOnce(
      response(200, { "content-length": "100" }),
    );
    await expect(
      make()("https://jobs.example.com", { maxBodyBytes: 5 }),
    ).rejects.toThrow(BodySizeError);
    mock.request.mockResolvedValueOnce(response(200, {}, ["123", "456"]));
    await expect(
      make()("https://jobs.example.com", { maxBodyBytes: 5 }),
    ).rejects.toThrow(BodySizeError);
    mock.request
      .mockResolvedValueOnce(response(302, { location: "/b" }, ["123"]))
      .mockResolvedValueOnce(response(200, {}, ["456"]));
    await expect(
      make()("https://jobs.example.com", { maxBodyBytes: 5 }),
    ).rejects.toThrow(BodySizeError);
  });
  it("applies the total timeout to DNS and propagates transport failure", async () => {
    resolve.mockImplementationOnce(() => new Promise(() => {}));
    await expect(
      make()("https://jobs.example.com", { timeoutMs: 5 }),
    ).rejects.toThrow();
    mock.request.mockRejectedValueOnce(new Error("network timeout"));
    await expect(make()("https://jobs.example.com")).rejects.toThrow(
      "network timeout",
    );
    expect(mock.destroy).toHaveBeenCalled();
  });
  it.each([
    { timeoutMs: 0 },
    { timeoutMs: 60001 },
    { maxBodyBytes: 0 },
    { maxBodyBytes: 21 * 1024 * 1024 },
    { maxRedirects: 4 },
    { maxRedirects: -1 },
  ])(
    "rejects invalid limits %o",
    async (options) =>
      await expect(make()("https://jobs.example.com", options)).rejects.toThrow(
        "limits",
      ),
  );
});
describe("per-host token buckets", () => {
  it("shares limits per hostname and refills independently", () => {
    let now = 0;
    const limiter = new HostRateLimiter(1, 1, () => now);
    limiter.take("EXAMPLE.COM");
    expect(() => limiter.take("example.com")).toThrow();
    limiter.take("other.example.com");
    now = 1000;
    limiter.take("example.com");
  });
  it("bounds host cardinality and validates settings", () => {
    const limiter = new HostRateLimiter(1, 1, Date.now, 1);
    limiter.take("a");
    expect(() => limiter.take("b")).toThrow("capacity");
    expect(() => new HostRateLimiter(0)).toThrow();
    expect(() => new HostRateLimiter(Infinity)).toThrow();
  });
});
