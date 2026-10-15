import { describe, expect, it, vi, afterEach } from "vitest";
import fixtures from "../fixtures/job_sources/tier1.json";
import { fetchBoard, dedupeHash, getJson } from "../../apps/ingest/src/adapters";
import type { HttpClient } from "../../src/lib/ingestion/ssrf-client";
import { RankingProfileSchema, rankJobs, parseCsv } from "../../apps/ingest/src/rank";
import { logFailure } from "../../apps/ingest/src/config";
const mockClient = (payload: unknown, status = 200) => vi.fn<HttpClient>().mockResolvedValue({ status, text: JSON.stringify(payload), headers: {} });
const board = { token: "example", company: "Example", source: "fixture" };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("ingestion adapters (fixture-only, injected HTTP)", () => {
  it("maps Greenhouse source IDs, location, description, and URL", async () => {
    const client = mockClient(fixtures.greenhouse);
    const [job] = await fetchBoard({ ...board, ats: "greenhouse" }, client);
    const source = fixtures.greenhouse.jobs[0]!;
    expect(job).toMatchObject({ id: `greenhouse:example:${source.id}`, sourceJobId: String(source.id), title: source.title, location: source.location.name, url: source.absolute_url });
    expect(job?.descriptionText).not.toContain("<p>");
    expect(client).toHaveBeenCalledWith("https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true", expect.objectContaining({ accept: "application/json" }));
  });
  it("maps Lever categories, apply URL and posting date", async () => {
    const [job] = await fetchBoard({ ...board, ats: "lever" }, mockClient(fixtures.lever));
    const source = fixtures.lever[0]!;
    expect(job).toMatchObject({ sourceJobId: source.id, title: source.text, location: source.categories.location, applyUrl: source.applyUrl, url: source.hostedUrl });
  });
  it("includes only explicitly listed Ashby jobs", async () => {
    const source = fixtures.ashby.jobs[0]!;
    const missingFlag: Partial<typeof source> = { ...source };
    delete missingFlag.isListed;
    const jobs = await fetchBoard({ ...board, ats: "ashby" }, mockClient({ jobs: [...fixtures.ashby.jobs, missingFlag] }));
    expect(jobs.map(j => j.sourceJobId)).toEqual(fixtures.ashby.jobs.filter(j => j.isListed === true).map(j => j.id));
    expect(jobs[0]).toMatchObject({ title: source.title, location: source.location, applyUrl: source.applyUrl });
  });
  it.each(["greenhouse", "lever", "ashby"] as const)("rejects invalid %s payload instead of succeeding empty", async ats => {
    await expect(fetchBoard({ ...board, ats }, mockClient({ broken: true }))).rejects.toThrow();
  });
  it("rejects board tokens with URL traversal before HTTP", async () => {
    const client = mockClient({});
    await expect(fetchBoard({ ...board, token: "../private", ats: "greenhouse" }, client)).rejects.toThrow();
    expect(client).not.toHaveBeenCalled();
  });
  it("paginates SmartRecruiters and preserves job identity", async () => {
    const client = mockClient({ content: [{ id: "a", name: "Engineer" }], totalFound: 2 });
    client.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ content: [{ id: "b", name: "Engineer" }], totalFound: 2 }), headers: {} });
    const jobs = await fetchBoard({ ...board, ats: "smartrecruiters" }, client);
    expect(jobs.map(j => j.sourceJobId)).toEqual(["b", "a"]);
    expect(client.mock.calls[1]?.[0]).toContain("offset=1");
  });
  it.each([301, 302, 307, 308, 400, 404])("does not follow/retry HTTP %s", async status => {
    const client = mockClient({}, status);
    await expect(getJson("https://example.com/jobs", 3, client)).rejects.toThrow(`HTTP ${status}`);
    expect(client).toHaveBeenCalledTimes(1);
  });
  it("retries transient failure with a bounded retry count", async () => {
    vi.useFakeTimers();
    const client = mockClient({}, 503);
    const assertion = expect(getJson("https://example.com/jobs", 3, client)).rejects.toThrow("HTTP 503");
    await vi.runAllTimersAsync(); await assertion;
    expect(client).toHaveBeenCalledTimes(3);
  });
  it("propagates malformed JSON and transport errors", async () => {
    await expect(getJson("https://example.com", 1, vi.fn<HttpClient>().mockResolvedValue({ status: 200, text: "bad", headers: {} }))).rejects.toThrow();
    await expect(getJson("https://example.com", 1, vi.fn<HttpClient>().mockRejectedValue(new Error("Blocked")))).rejects.toThrow("Blocked");
  });
});
describe("opening identity", () => {
  it("retains separate requisitions with identical title and location", () => {
    expect(dedupeHash("Acme", "Engineer", "NY", "req-1")).not.toBe(dedupeHash("Acme", "Engineer", "NY", "req-2"));
  });
  it("retains separate locations on the same requisition", () => {
    expect(dedupeHash("Acme", "Engineer", "NY", "req-1")).not.toBe(dedupeHash("Acme", "Engineer", "SF", "req-1"));
  });
  it("is stable for normalized display fields and exact job ID", () => {
    expect(dedupeHash(" ACME ", "Engineer!", "NY", "req-1")).toBe(dedupeHash("acme", "engineer", "ny", "req-1"));
  });
  it("retains separate boards with overlapping job IDs", async () => {
    const first = await fetchBoard({ ...board, ats: "greenhouse" }, mockClient(fixtures.greenhouse));
    const second = await fetchBoard({ ...board, token: "other", ats: "greenhouse" }, mockClient(fixtures.greenhouse));
    expect(first[0]?.dedupeHash).not.toBe(second[0]?.dedupeHash);
  });
});
describe("typed ranking and failure reporting", () => {
  const profile = RankingProfileSchema.parse({ titleInclude: "engineer", titleExclude: "director", locationPattern: "hybrid", allowRemote: false, keywordVeto: "clearance", query: "systems engineer" });
  it("ranks from the supplied profile and handles empty inputs", async () => {
    const jobs = await fetchBoard({ ...board, ats: "greenhouse" }, mockClient(fixtures.greenhouse));
    expect(rankJobs(jobs, profile).top).toHaveLength(1);
    expect(rankJobs(jobs, { ...profile, titleInclude: "nurse" }).top).toHaveLength(0);
    expect(rankJobs([], profile, 50, "").filterStats.total).toBe(0);
  });
  it("filters an applied role from an explicitly supplied tracker", async () => {
    const jobs = await fetchBoard({ ...board, ats: "greenhouse" }, mockClient(fixtures.greenhouse));
    expect(rankJobs(jobs, profile, 50, `Company,Role\nExample,${jobs[0]!.title}`).filterStats.alreadyApplied).toBe(1);
    expect(parseCsv('Company,Role\n"Acme, Inc","A ""quoted"" role"')).toEqual([["Company", "Role"], ["Acme, Inc", 'A "quoted" role']]);
  });
  it("rejects invalid regex config", () => {
    expect(RankingProfileSchema.safeParse({ ...profile, titleInclude: "[" }).success).toBe(false);
  });
  it("logs structured provider and board context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(logFailure("lever", "example", new Error("HTTP 404"))).toEqual({ provider: "lever", board: "example", error: "HTTP 404" });
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({ event: "ingestion_failure", provider: "lever", board: "example" });
  });
});
