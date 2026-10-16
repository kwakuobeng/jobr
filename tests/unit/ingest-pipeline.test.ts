import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import boards from "../../data/job-boards.json";
import type { HttpClient } from "../../src/lib/ingestion/ssrf-client";
import {
  BoardSchema, embedPendingJobs, fetchClient, fetchSourceJobs, runSource, slugify, syncBoards, toBatchRow, type Db, type Source,
} from "../../src/lib/ingestion/pipeline";
const fixtures = JSON.parse(readFileSync(new URL("../fixtures/job_sources/tier1_fixtures.json", import.meta.url), "utf8")) as Record<string, unknown>;
const client = (payload: unknown, status = 200) => vi.fn<HttpClient>().mockResolvedValue({ status, text: JSON.stringify(payload), headers: {} });
const source = (provider_type: string, tenant_slug: string | null = "acme"): Source => ({ id: "11111111-1111-4111-8111-111111111111", provider_type, tenant_slug, display_name: "Acme" });

/** Chainable fake of the supabase-js query builder. */
function fakeDb(rows: unknown[] = [], rpcData: unknown = [{ inserted: 1, merged: 0, updated: 0 }], errors: { rpc?: string; from?: string } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit", "update", "upsert"]) b[m] = (...args: unknown[]) => { calls.push([`${table}.${m}`, ...args]); return b; };
    b.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: errors.from ? { message: errors.from } : null });
    return b;
  };
  const db: Db = {
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => { calls.push([`rpc.${fn}`, args]); return { data: rpcData, error: errors.rpc && fn === "ingest_job_batch" ? { message: errors.rpc } : null }; }),
    from: (table: string) => builder(table),
  };
  return { db, calls };
}

describe("curated board list", () => {
  it("has 100+ unique Greenhouse/Ashby boards, each verified with HTTP 200", () => {
    const list = BoardSchema.array().parse(boards);
    expect(list.length).toBeGreaterThanOrEqual(100);
    expect(new Set(list.map((b) => `${b.ats}:${b.token}`)).size).toBe(list.length);
    expect(list.every((b) => b.httpStatusAtVerify === 200 && (b.jobsAtVerify ?? 0) > 0)).toBe(true);
    expect(new Set(list.map((b) => b.ats))).toEqual(new Set(["greenhouse", "ashby"]));
  });
});

describe("fetchClient", () => {
  it("allows only HTTPS on allowlisted hosts and never follows redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200, headers: { etag: "x" } }));
    const get = fetchClient(["api.ashbyhq.com"], fetchImpl as unknown as typeof fetch);
    await expect(get("https://api.ashbyhq.com/posting-api/job-board/a")).resolves.toMatchObject({ status: 200, text: "{}", headers: { etag: "x" } });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.ashbyhq.com/posting-api/job-board/a", expect.objectContaining({ redirect: "manual", method: "GET" }));
    await expect(get("https://evil.example/x")).rejects.toThrow("Blocked");
    await expect(get("http://api.ashbyhq.com/x")).rejects.toThrow("Blocked");
    await expect(get("https://u:p@api.ashbyhq.com/x")).rejects.toThrow("Blocked");
  });
  it("rejects oversized bodies", async () => {
    const big = { text: async () => "x".repeat(20 * 1024 * 1024 + 1), status: 200, headers: new Headers() };
    const get = fetchClient(["api.lever.co"], (async () => big) as unknown as typeof fetch);
    await expect(get("https://api.lever.co/v0/postings/a")).rejects.toThrow("too large");
  });
});

describe("fetchSourceJobs", () => {
  it("normalizes Greenhouse, Ashby and Lever boards from their public endpoints", async () => {
    const gh = client(fixtures.greenhouse);
    expect((await fetchSourceJobs(source("greenhouse"), { client: gh })).length).toBeGreaterThan(0);
    expect(gh).toHaveBeenCalledWith("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true", {});
    const ash = client(fixtures.ashby);
    expect((await fetchSourceJobs(source("ashby"), { client: ash })).length).toBeGreaterThan(0);
    expect(ash.mock.calls[0]?.[0]).toBe("https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true");
    expect((await fetchSourceJobs(source("lever"), { client: client(fixtures.lever) })).length).toBeGreaterThan(0);
  });
  it("pages USAJOBS with the key headers and stops on a short page", async () => {
    const usa = client(fixtures.usajobs);
    const jobs = await fetchSourceJobs(source("usajobs", "usajobs-search"), { client: usa, usajobs: { apiKey: "k", userAgent: "a@b.co" } });
    expect(jobs.length).toBeGreaterThan(0);
    expect(usa).toHaveBeenCalledTimes(1);
    expect(usa.mock.calls[0]?.[0]).toContain("ResultsPerPage=500");
    expect(usa.mock.calls[0]?.[0]).not.toContain("Keyword");
    expect(usa.mock.calls[0]?.[1]).toEqual({ "Authorization-Key": "k", "User-Agent": "a@b.co" });
    const kw = client(fixtures.usajobs);
    await fetchSourceJobs(source("usajobs", "data analyst"), { client: kw, usajobs: { apiKey: "k", userAgent: "a@b.co" }, usajobsMaxPages: 1 });
    expect(kw.mock.calls[0]?.[0]).toContain("Keyword=data+analyst");
  });
  it("fails closed on bad config, unsupported providers and non-200 responses", async () => {
    await expect(fetchSourceJobs(source("usajobs"), { client: client({}) })).rejects.toThrow("credentials");
    await expect(fetchSourceJobs(source("workday"), { client: client({}) })).rejects.toThrow("Unsupported");
    await expect(fetchSourceJobs(source("greenhouse", "../x"), { client: client({}) })).rejects.toThrow("Invalid board token");
    await expect(fetchSourceJobs(source("greenhouse", null), { client: client({}) })).rejects.toThrow("Invalid board token");
    await expect(fetchSourceJobs(source("ashby"), { client: client({}, 404) })).rejects.toThrow("HTTP 404");
  });
  it("uses the default fetch client when none is injected", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fixtures.lever)));
    expect((await fetchSourceJobs(source("lever"))).length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe("toBatchRow", () => {
  it("maps a payload with slug, simhash, hash and stored country codes", async () => {
    const [job] = await fetchSourceJobs(source("ashby"), { client: client(fixtures.ashby) });
    const row = await toBatchRow({ ...job!, rawLocations: ["Austin, us", " Austin, us ", "London, gb"], publishedAt: "not a date" });
    expect(row.locations).toEqual(["Austin, us", "London, gb"]);
    expect(row.country_codes).toEqual(["GB", "US"]);
    expect(row.title_slug).toBe(slugify(job!.rawTitle));
    expect(row.raw_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.published_at).toBeNull();
    expect(BigInt(row.simhash)).toBeTypeOf("bigint");
    const plain = await toBatchRow({ ...job!, rawCompensation: undefined, rawEmployerDomain: undefined, publishedAt: "2026-10-01T00:00:00Z" });
    expect(plain).toMatchObject({ min_usd: null, max_usd: null, currency: "USD", employer_domain: null, published_at: "2026-10-01T00:00:00.000Z" });
    expect(slugify("!!!")).toBe("unknown");
  });
});

describe("db steps", () => {
  it("syncBoards upserts active hourly sources and returns supported ones", async () => {
    const { db, calls } = fakeDb([{ id: "11111111-1111-4111-8111-111111111111", provider_type: "ashby", tenant_slug: "a", display_name: "A" },
      { id: "21111111-1111-4111-8111-111111111111", provider_type: "smartrecruiters", tenant_slug: "c", display_name: "C" }]);
    const out = await syncBoards(db, [{ ats: "greenhouse", token: "g", company: "G" }, { ats: "ashby", token: "a", company: "A" }]);
    expect(out.map((s) => s.provider_type)).toEqual(["ashby"]);
    const upsert = calls.find((c) => c[0] === "job_sources.upsert")!;
    expect(upsert[1]).toEqual([
      expect.objectContaining({ provider_type: "greenhouse", tenant_slug: "g", is_active: true, poll_interval_minutes: 60, base_endpoint_url: "https://boards-api.greenhouse.io/v1/boards/g/jobs" }),
      expect.objectContaining({ provider_type: "ashby", base_endpoint_url: "https://api.ashbyhq.com/posting-api/job-board/a" }),
    ]);
    const empty = fakeDb([]);
    await syncBoards(empty.db, []);
    expect(empty.calls.some((c) => c[0] === "job_sources.upsert")).toBe(false);
    await expect(syncBoards(fakeDb([], [], { from: "boom" }).db, [])).rejects.toThrow("load job_sources: boom");
  });
  it("runSource writes ≤500-row pages and sums counts", async () => {
    const { db, calls } = fakeDb();
    const result = await runSource(db, source("ashby"), { client: client(fixtures.ashby) });
    expect(result).toMatchObject({ inserted: 1, merged: 0, updated: 0 });
    expect(result.fetched).toBeGreaterThan(0);
    expect(calls.filter((c) => c[0] === "rpc.ingest_job_batch")).toHaveLength(1);
    const none = fakeDb([], []);
    expect(await runSource(none.db, source("ashby"), { client: client(fixtures.ashby) })).toMatchObject({ inserted: 0 });
  });
  it("runSource records a failure and rethrows", async () => {
    const { db, calls } = fakeDb([], [], { rpc: "denied" });
    await expect(runSource(db, source("ashby"), { client: client(fixtures.ashby) })).rejects.toThrow("ingest_job_batch: denied");
    expect(calls.some((c) => c[0] === "rpc.record_source_failure")).toBe(true);
  });
  it("embedPendingJobs embeds and stores 768-dim vectors with model + hash", async () => {
    const { db, calls } = fakeDb([{ id: "j1", title: "AE", employer_name: "Acme", extracted_required_skills: null, description_plain: "Sell" }]);
    const embed = vi.fn(async (texts: string[]) => texts.map(() => Array(768).fill(0.1)));
    expect(await embedPendingJobs(db, embed, 10)).toBe(1);
    const update = calls.find((c) => c[0] === "canonical_jobs.update")![1] as Record<string, unknown>;
    expect(update).toMatchObject({ embedding_model: "@cf/baai/bge-base-en-v1.5" });
    expect(String(update.requirements_embedding).startsWith("[0.1,")).toBe(true);
    expect(await embedPendingJobs(fakeDb([]).db, embed)).toBe(0);
  });
});
