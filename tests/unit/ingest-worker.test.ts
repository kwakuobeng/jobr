import { describe, expect, it, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as unknown[], single: null as unknown, rpc: [] as string[], rpcError: null as null | { message: string }, fromError: null as null | { message: string } }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    const builder = () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order", "limit", "update", "upsert"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: state.single, error: state.fromError });
      b.then = (resolve: (v: unknown) => void) => resolve({ data: state.rows, error: state.fromError });
      return b;
    };
    return { from: builder, rpc: async (fn: string) => { state.rpc.push(fn); return { data: fn === "ingest_job_batch" ? [{ inserted: 2, merged: 0, updated: 0 }] : 0, error: state.rpcError }; } };
  },
}));
import worker, { consume, scheduled, type Env } from "../../apps/ingest/worker/index";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(new URL("../fixtures/job_sources/tier1_fixtures.json", import.meta.url), "utf8")) as Record<string, unknown>;
const env = (extra: Partial<Env> = {}): Env => ({
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service",
  AI: { run: vi.fn(async (_m: string, input: { text: string[] }) => ({ data: input.text.map(() => Array(768).fill(0.2)) })) },
  INGEST_QUEUE: { sendBatch: vi.fn(async () => {}) }, ...extra,
});
const msg = (body: unknown) => ({ body, ack: vi.fn(), retry: vi.fn() });
beforeEach(() => { state.rows = []; state.single = null; state.rpc = []; state.rpcError = null; state.fromError = null; vi.spyOn(console, "log").mockImplementation(() => {}); });

describe("ingest worker (Cron → Queue → consumer)", () => {
  it("cron syncs boards, enqueues one message per active source and runs housekeeping", async () => {
    state.rows = Array.from({ length: 150 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, provider_type: "greenhouse", tenant_slug: `b${i}`, display_name: "B" }));
    const e = env({ USAJOBS_API_KEY: "k", USAJOBS_USER_AGENT_EMAIL: "a@b.co" });
    expect(await scheduled(e)).toBe(150);
    expect(e.INGEST_QUEUE.sendBatch).toHaveBeenCalledTimes(2);
    expect(state.rpc).toEqual(["merge_duplicate_postings", "close_stale_jobs"]);
    const waits: Promise<unknown>[] = [];
    await worker.scheduled({}, env(), { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  });
  it("consumer ingests a source, acks, then embeds pending jobs", async () => {
    state.single = { id: "11111111-1111-4111-8111-111111111111", provider_type: "lever", tenant_slug: "acme", display_name: "Acme" };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fixtures.lever)));
    state.rows = [{ id: "j1", title: "AE", employer_name: "Acme", extracted_required_skills: [], description_plain: "x" }];
    const m = msg({ sourceId: "11111111-1111-4111-8111-111111111111" });
    const e = env();
    await worker.queue({ messages: [m] }, e);
    expect(m.ack).toHaveBeenCalled();
    expect(state.rpc).toContain("ingest_job_batch");
    expect(e.AI.run).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("acks inactive sources, retries failures, and survives embedding errors", async () => {
    const gone = msg({ sourceId: "11111111-1111-4111-8111-111111111111" });
    const bad = msg({ nope: 1 });
    await consume([gone, bad], env({ AI: { run: async () => { throw new Error("quota"); } } }));
    expect(gone.ack).toHaveBeenCalled();
    expect(bad.retry).toHaveBeenCalled();
    state.fromError = { message: "db down" };
    const failing = msg({ sourceId: "11111111-1111-4111-8111-111111111111" });
    await consume([failing], env());
    expect(failing.retry).toHaveBeenCalled();
  });
  it("logs provider and board on failure and counts retries in the run summary", async () => {
    state.single = { id: "11111111-1111-4111-8111-111111111111", provider_type: "lever", tenant_slug: "acme", display_name: "Acme" };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));
    const sourceId = "11111111-1111-4111-8111-111111111111";
    const m = msg({ sourceId });
    await consume([m], env());
    expect(m.retry).toHaveBeenCalledOnce();
    expect(m.ack).not.toHaveBeenCalled();
    const logs = vi.mocked(console.log).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(logs).toContainEqual(expect.objectContaining({ event: "source_failed", provider: "lever", board: "acme", sourceId }));
    expect(logs).toContainEqual(expect.objectContaining({ event: "queue_summary", messages: 1, failed: 1, succeeded: 0 }));
    spy.mockRestore();
  });
  it("rejects cron when housekeeping or source synchronization fails", async () => {
    state.rpcError = { message: "housekeeping unavailable" };
    await expect(scheduled(env())).rejects.toThrow("housekeeping failed");
    state.fromError = { message: "source sync unavailable" };
    await expect(scheduled(env({ USAJOBS_API_KEY: "k", USAJOBS_USER_AGENT_EMAIL: "test@example.com" }))).rejects.toThrow("USAJOBS source sync");
  });
  it("reports embedding failures separately from source delivery", async () => {
    state.rows = [{ id: "j1", title: "AE", employer_name: "Acme", extracted_required_skills: [], description_plain: "x" }];
    await consume([], env({ AI: { run: async () => { throw new Error("quota"); } } }));
    const logs = vi.mocked(console.log).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(logs).toContainEqual(expect.objectContaining({ event: "queue_summary", failed: 0, embeddingFailures: 1 }));
  });
});
