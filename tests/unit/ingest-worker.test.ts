import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchBoard } from "../../apps/ingest/src/adapters";
import worker from "../../apps/ingest/worker/index";
vi.mock("../../apps/ingest/src/adapters", () => ({ fetchBoard: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
describe("undeployed worker run summaries", () => {
  it("logs every failed provider/board and counts failures", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchBoard).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("HTTP 503"));
    await worker.scheduled({}, { SEED_BOARDS_JSON: JSON.stringify([
      { ats: "greenhouse", token: "ok", company: "A", source: "fixture" },
      { ats: "lever", token: "broken", company: "B", source: "fixture" },
    ]) });
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toEqual({ event: "ingestion_failure", provider: "lever", board: "broken", error: "HTTP 503" });
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({ boards: 2, ok: 1, failures: 1, jobs: 0 });
  });
  it("handles an empty enabled board registry without NaN shards", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await worker.scheduled({}, { SEED_BOARDS_JSON: "[]" });
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({ shard: 0, boards: 0, failures: 0 });
  });
});
