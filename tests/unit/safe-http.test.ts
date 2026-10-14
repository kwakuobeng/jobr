import { it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  request: vi.fn(),
  agent: vi.fn(),
}));
vi.mock("undici", () => ({
  Agent: class {
    constructor(options: unknown) {
      mocks.agent(options);
    }
    close = mocks.close;
  },
  request: mocks.request,
}));
import { createSafeClient } from "@/lib/ingestion/ssrf-client";
it("creates a socket-guarded dispatcher, bounds transport, and closes on success", async () => {
  mocks.request.mockResolvedValue({
    statusCode: 200,
    headers: { etag: "v1" },
    body: { text: async () => '{"jobs":[]}' },
  });
  const result = await createSafeClient(["example.com"])(
    "https://example.com/jobs",
    { Accept: "application/json" },
  );
  expect(result).toEqual({
    status: 200,
    headers: { etag: "v1" },
    text: '{"jobs":[]}',
  });
  expect(mocks.agent).toHaveBeenCalledWith(
    expect.objectContaining({
      connect: expect.objectContaining({
        lookup: expect.any(Function),
        timeout: 5000,
      }),
      maxResponseSize: 5 * 1024 * 1024,
    }),
  );
  expect(mocks.request).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      maxRedirections: 0,
      headersTimeout: 10000,
      bodyTimeout: 10000,
      signal: expect.any(AbortSignal),
    }),
  );
  expect(mocks.close).toHaveBeenCalled();
});
it("closes on transport or body failure", async () => {
  mocks.request.mockRejectedValueOnce(new Error("timeout"));
  await expect(createSafeClient()("https://example.com")).rejects.toThrow(
    "timeout",
  );
  mocks.request.mockResolvedValueOnce({
    statusCode: 200,
    headers: {},
    body: {
      text: async () => {
        throw new Error("oversize");
      },
    },
  });
  await expect(createSafeClient()("https://example.com")).rejects.toThrow(
    "oversize",
  );
  expect(mocks.close).toHaveBeenCalledTimes(3);
});
