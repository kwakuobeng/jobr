import { beforeEach, describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock("@/lib/http/safe_fetch", () => ({ safeFetch: mock.http }));
import {
  fetchBoard,
  fetchRawBoard,
  getJson,
  endpoints,
} from "../../apps/ingest/src/adapters";
import { GreenhouseAdapter } from "@/lib/ingestion/adapters/greenhouse";
import { AshbyAdapter } from "@/lib/ingestion/adapters/ashby";
import { LeverAdapter } from "@/lib/ingestion/adapters/lever";
import { UsaJobsAdapter } from "@/lib/ingestion/adapters/usajobs";
import fixtures from "../fixtures/job_sources/tier1.json";
import { RawJobPayloadSchema } from "../../specs/ingestion/zod_provider_schemas";
import type { HttpClient } from "@/lib/ingestion/ssrf-client";
const reply = (payload: unknown, status = 200) => ({
  status,
  headers: {},
  text: JSON.stringify(payload),
  url: "https://api.example.com",
});
const tenant = {
  slug: "fixture",
  employerName: "Fixture",
  employerDomain: "fixture.example.com",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("USAJOBS_API_KEY", "fixture-key");
  vi.stubEnv("USAJOBS_USER_AGENT_EMAIL", "user@example.com");
});
describe("canonical PR #2 adapter integration", () => {
  it.each([
    ["greenhouse", GreenhouseAdapter, fixtures.greenhouse],
    ["ashby", AshbyAdapter, fixtures.ashby],
    ["lever", LeverAdapter, fixtures.lever],
    ["usajobs", UsaJobsAdapter, fixtures.usajobs],
  ] as const)(
    "%s fetchJobs delegates to canonical Gemini-validated adapter",
    async (provider, Adapter, payload) => {
      mock.http.mockResolvedValue(reply(payload));
      const jobs = await new Adapter().fetchJobs(tenant);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.sourceProvider).toBe(provider);
      expect(jobs[0]?.rawEmployerDomain).toBe(tenant.employerDomain);
      jobs.forEach((j) => RawJobPayloadSchema.parse(j));
      expect(mock.http).toHaveBeenCalledWith(
        expect.stringMatching(/^https:/),
        expect.objectContaining({
          allowedHosts: expect.arrayContaining(["boards-api.greenhouse.io"]),
        }),
      );
    },
  );
  it.each([
    ["greenhouse", GreenhouseAdapter, fixtures.greenhouse],
    ["ashby", AshbyAdapter, fixtures.ashby],
    ["lever", LeverAdapter, fixtures.lever],
    ["usajobs", UsaJobsAdapter, fixtures.usajobs],
  ] as const)(
    "%s retains injectable transport for unit tests",
    async (_provider, Adapter, payload) => {
      const http: HttpClient = vi.fn(async () => reply(payload));
      expect(await new Adapter(http).fetchJobs(tenant)).toHaveLength(1);
      expect(http).toHaveBeenCalled();
      expect(mock.http).not.toHaveBeenCalled();
    },
  );
  it("preserves legacy fetchBoard listing IDs and rich canonical data", async () => {
    mock.http.mockResolvedValue(
      reply({
        jobs: [
          {
            ...fixtures.greenhouse.jobs[0],
            departments: [{ name: "Engineering" }],
          },
        ],
      }),
    );
    const rows = await fetchBoard({
      ats: "greenhouse",
      token: "stripe",
      company: "Stripe",
      source: "fixture",
    });
    expect(rows[0]).toMatchObject({
      id: "greenhouse:stripe:4918273",
      department: "Engineering",
      sourceJobId: "4918273",
      company: "Stripe",
    });
    expect(rows[0]?.rawPayload?.complianceMetadata?.include_ai_disclaimer).toBe(
      true,
    );
  });
  it("maps Ashby/Lever departments through the canonical listing contract", async () => {
    for (const [ats, payload] of [
      ["ashby", fixtures.ashby],
      ["lever", fixtures.lever],
    ] as const) {
      mock.http.mockResolvedValue(reply(payload));
      expect(
        (
          await fetchBoard({
            ats,
            token: "fixture",
            company: "Fixture",
            source: "fixture",
          })
        )[0]?.department,
      ).toBeDefined();
    }
  });
  it("drops Ashby unlisted and unspecified listing status", async () => {
    mock.http.mockResolvedValue(
      reply({
        jobs: [
          fixtures.ashby.jobs[1],
          { ...fixtures.ashby.jobs[0], isListed: undefined },
        ],
      }),
    );
    expect(
      await fetchRawBoard({
        ats: "ashby",
        token: "fixture",
        company: "X",
        source: "fixture",
      }),
    ).toEqual([]);
  });
  it("reads USAJOBS credentials from environment and never places them in the URL", async () => {
    mock.http.mockResolvedValue(reply(fixtures.usajobs));
    await fetchRawBoard({
      ats: "usajobs",
      token: "software",
      company: "Federal",
      source: "fixture",
    });
    const [url, options] = mock.http.mock.calls[0]!;
    expect(url).not.toContain("fixture-key");
    expect(options.headers).toMatchObject({
      "authorization-key": "fixture-key",
      "user-agent": "user@example.com",
    });
    vi.stubEnv("USAJOBS_API_KEY", "");
    await expect(
      fetchRawBoard({
        ats: "usajobs",
        token: "software",
        company: "Federal",
        source: "fixture",
      }),
    ).rejects.toThrow();
  });
  it("allows only validated board slugs", async () => {
    expect(() => endpoints.greenhouse("../metadata")).toThrow();
    expect(() => endpoints.lever("https://evil.com")).toThrow();
    expect(() => endpoints.ashby("bad/token")).toThrow();
    expect(() => endpoints.smartrecruiters("x?url=evil")).toThrow();
    await expect(
      fetchRawBoard({ ats: "ashby", token: "../x", company: "X", source: "" }),
    ).rejects.toThrow();
    expect(endpoints.usajobs("software")).toContain("Keyword=software");
  });
  it("validates source schemas and fails closed on upstream errors", async () => {
    mock.http.mockResolvedValue(reply({ jobs: [{}] }));
    await expect(
      fetchRawBoard({
        ats: "greenhouse",
        token: "x",
        company: "X",
        source: "",
      }),
    ).rejects.toThrow();
    mock.http.mockResolvedValue(reply({}, 403));
    await expect(
      getJson("https://api.lever.co/v0/postings/x", 1),
    ).rejects.toThrow("403");
    await expect(getJson("https://api.lever.co", 0)).rejects.toThrow("retry");
  });
  it("retains bounded SmartRecruiters pagination and normalization", async () => {
    const posting = {
      id: "1",
      name: "Engineer",
      location: { city: "Dallas", region: "TX", country: "US", remote: true },
      department: { label: "Engineering" },
      releasedDate: "2026-10-14",
    };
    mock.http
      .mockResolvedValueOnce(reply({ content: [posting], totalFound: 2 }))
      .mockResolvedValueOnce(
        reply({ content: [{ ...posting, id: "2" }], totalFound: 2 }),
      );
    const rows = await fetchBoard({
      ats: "smartrecruiters",
      token: "Example",
      company: "Example",
      source: "fixture",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.department).toBe("Engineering");
    expect(rows[0]?.remote).toBe(true);
    expect(mock.http.mock.calls[1]?.[0]).toContain("offset=1");
  });
  it("stops SmartRecruiters pagination on empty pages and supports missing metadata", async () => {
    mock.http
      .mockResolvedValueOnce(
        reply({ content: [{ id: 1, name: "Engineer" }], totalFound: 2 }),
      )
      .mockResolvedValueOnce(reply({ content: [], totalFound: 2 }));
    const rows = await fetchBoard({
      ats: "smartrecruiters",
      token: "X",
      company: "X",
      source: "",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.remote).toBe(false);
  });
  it("retries a transient source response then succeeds", async () => {
    vi.useFakeTimers();
    mock.http
      .mockResolvedValueOnce(reply({}, 503))
      .mockResolvedValueOnce(reply({ ok: true }));
    const work = getJson("https://api.lever.co/v0/postings/x", 2);
    await vi.runAllTimersAsync();
    expect(await work).toEqual({ ok: true });
    vi.useRealTimers();
  });
});
