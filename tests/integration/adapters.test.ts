import { describe, it, expect, vi } from "vitest";
import { GreenhouseAdapter } from "@/lib/ingestion/adapters/greenhouse";
import { AshbyAdapter } from "@/lib/ingestion/adapters/ashby";
import { LeverAdapter } from "@/lib/ingestion/adapters/lever";
import { UsaJobsAdapter } from "@/lib/ingestion/adapters/usajobs";
import {
  JsonLdUrlAdapter,
  normalizeJsonLd,
} from "@/lib/ingestion/adapters/jsonld";
import { verifyUrlActive } from "@/lib/ingestion/verifier";
import {
  RawJobPayloadSchema,
  normalizeAshbyPayload,
  normalizeGreenhousePayload,
  annualizeCompensation,
} from "../../specs/ingestion/zod_provider_schemas";
import fixtures from "../fixtures/job_sources/tier1.json";
import type { HttpClient } from "@/lib/ingestion/ssrf-client";
const clientFor = (value: unknown, status = 200): HttpClient =>
  vi
    .fn()
    .mockResolvedValue({
      status,
      headers: { etag: "board-v1" },
      text: JSON.stringify(value),
    });
const config = { tenant: "stripe", employerName: "Stripe" };
const posting = {
  "@type": "JobPosting",
  title: "Engineer",
  description: "<p>Build software</p>",
  hiringOrganization: { name: "Acme" },
  jobLocationType: "TELECOMMUTE",
  baseSalary: {
    currency: "USD",
    value: { minValue: 10, maxValue: 20, unitText: "HOUR" },
  },
};
const html = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const htmlClient = (value: unknown): HttpClient =>
  vi.fn().mockResolvedValue({ status: 200, headers: {}, text: html(value) });
describe("recorded synthetic adapter fixtures", () => {
  it.each([
    ["greenhouse", GreenhouseAdapter, fixtures.greenhouse],
    ["ashby", AshbyAdapter, fixtures.ashby],
    ["lever", LeverAdapter, fixtures.lever],
  ] as const)(
    "%s validates canonical output and headers",
    async (provider, Adapter, fixture) => {
      const client = clientFor(fixture),
        adapter = new Adapter(client);
      const result = await adapter.fetchIncremental(null, config);
      expect(result.jobs).toHaveLength(1);
      result.jobs.forEach((job) =>
        expect(RawJobPayloadSchema.safeParse(job).success).toBe(true),
      );
      expect(result.jobs[0]?.sourceProvider).toBe(provider);
      expect(result.nextWatermark.etag).toBe("board-v1");
      expect(
        await adapter.verifyListingActive(
          result.jobs[0]!.externalJobId,
          "https://localhost",
          config,
        ),
      ).toMatchObject({ isActive: true });
      expect(
        await adapter.verifyListingActive("missing", "", config),
      ).toMatchObject({ isActive: false, closedReason: "ats_unlisted" });
    },
  );
  it("requires explicit listed status and preserves non-USD amounts without labeling them USD", () => {
    const a = fixtures.ashby.jobs[0]!;
    expect(
      normalizeAshbyPayload("x", "X", undefined, {
        jobs: [{ ...a, isListed: undefined }],
      }),
    ).toEqual([]);
    const currencyJob = {
      ...a,
      compensation: {
        summaryComponents: [
          {
            compensationType: "Salary",
            interval: "1 MONTH",
            currencyCode: "EUR",
            minValue: 1000,
            maxValue: 2000,
          },
        ],
      },
    };
    expect(
      normalizeAshbyPayload("x", "X", undefined, { jobs: [currencyJob] })[0]
        ?.rawCompensation,
    ).toMatchObject({ currency: "EUR", interval: "month", minAmount: 1000 });
    expect(
      normalizeAshbyPayload("x", "X", undefined, { jobs: [currencyJob] })[0]
        ?.rawCompensation?.minAnnualUsd,
    ).toBeUndefined();
  });
  it("preserves Greenhouse zero-cent bounds and compliance notices", () => {
    const raw = fixtures.greenhouse.jobs[0]!;
    const result = normalizeGreenhousePayload("x", "X", undefined, {
      jobs: [
        {
          ...raw,
          pay_input_ranges: [
            { min_cents: 0, max_cents: 10050, currency_type: "USD" },
          ],
        },
      ],
    })[0]!;
    expect(result.rawCompensation).toMatchObject({
      minAmount: 0,
      maxAmount: 100.5,
    });
    expect(result.complianceMetadata?.include_ai_disclaimer).toBe(true);
  });
  it("supports conditional full-board fetch and rejects invalid status/schema/config", async () => {
    const adapter = new GreenhouseAdapter(clientFor({}, 304));
    const watermark = { lastSyncedAt: "2026-10-01", etag: "old" };
    expect((await adapter.fetchIncremental(watermark, config)).jobs).toEqual(
      [],
    );
    await expect(adapter.fetchIncremental(null, config)).rejects.toThrow();
    await expect(
      new GreenhouseAdapter(clientFor({}, 503)).fetchIncremental(null, config),
    ).rejects.toThrow("503");
    await expect(
      new GreenhouseAdapter(clientFor({ jobs: [] })).fetchIncremental(null, {
        ...config,
        tenant: "../evil",
      }),
    ).rejects.toThrow();
    await expect(
      new GreenhouseAdapter(clientFor({ jobs: [{}] })).fetchIncremental(
        null,
        config,
      ),
    ).rejects.toThrow();
    expect(new AshbyAdapter().providerName).toBe("ashby");
    expect(new LeverAdapter().providerName).toBe("lever");
    expect(new GreenhouseAdapter().providerName).toBe("greenhouse");
  });
  it("handles omitted and non-string ETags", async () => {
    const client: HttpClient = async () => ({
      status: 200,
      headers: { etag: ["a"] },
      text: JSON.stringify(fixtures.greenhouse),
    });
    expect(
      (await new GreenhouseAdapter(client).fetchIncremental(null, config))
        .nextWatermark.etag,
    ).toBeUndefined();
  });
  it("uses USAJOBS auth headers only on its API host and paginates explicitly", async () => {
    const c = clientFor(fixtures.usajobs),
      adapter = new UsaJobsAdapter(c),
      config = { apiKey: "fixture-key", userAgent: "user@example.com" };
    const first = await adapter.fetchIncremental(null, config);
    expect(first.jobs).toHaveLength(1);
    expect(first.nextWatermark.cursor).toBe("2");
    await adapter.fetchIncremental(first.nextWatermark, config);
    expect(c).toHaveBeenLastCalledWith(
      expect.stringContaining("Page=2"),
      expect.objectContaining({ "Authorization-Key": "fixture-key" }),
    );
    expect(
      await adapter.verifyListingActive(
        first.jobs[0]!.externalJobId,
        "",
        config,
      ),
    ).toMatchObject({ isActive: true });
    expect(
      await adapter.verifyListingActive("missing", "", config),
    ).toMatchObject({ isActive: false });
    expect(new UsaJobsAdapter().providerName).toBe("usajobs");
  });
  it("handles USAJOBS empty pages, bad cursors and upstream errors", async () => {
    const config = { apiKey: "x", userAgent: "u@example.com" },
      adapter = new UsaJobsAdapter(
        clientFor({ SearchResult: { SearchResultItems: [] } }),
      );
    expect(
      (await adapter.fetchIncremental(null, config)).nextWatermark.cursor,
    ).toBeUndefined();
    await expect(
      adapter.fetchIncremental({ lastSyncedAt: "", cursor: "NaN" }, config),
    ).rejects.toThrow("Invalid cursor");
    await expect(
      new UsaJobsAdapter(clientFor({}, 401)).fetchIncremental(null, config),
    ).rejects.toThrow("401");
    await expect(
      new UsaJobsAdapter(clientFor({}, 503)).verifyListingActive(
        "x",
        "",
        config,
      ),
    ).rejects.toThrow("503");
  });
  it("extracts JSON-LD single, array and graph postings without running script code", () => {
    const rows = normalizeJsonLd(
      html({ "@graph": [posting, { "@type": "WebPage" }] }),
      "https://example.com/job",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rawCompensation?.minAnnualUsd).toBe(20800);
    expect(
      normalizeJsonLd(
        html([
          {
            ...posting,
            "@type": ["Thing", "JobPosting"],
            identifier: "1",
            url: "https://example.com/1",
            jobLocation: { address: { addressLocality: "Dallas" } },
          },
          null,
          5,
        ]),
        "https://example.com",
      ),
    ).toHaveLength(1);
    expect(
      normalizeJsonLd(
        html({
          ...posting,
          identifier: { value: "2" },
          jobLocation: [
            { address: { addressRegion: "TX", addressCountry: "US" } },
          ],
          baseSalary: {
            currency: "EUR",
            value: { value: 100, unitText: "MONTH" },
          },
        }),
        "https://example.com",
      )[0]?.rawCompensation?.minAnnualUsd,
    ).toBeUndefined();
    expect(
      normalizeJsonLd(
        html({ ...posting, baseSalary: undefined, jobLocationType: undefined }),
        "https://example.com",
      )[0]?.rawCompensation,
    ).toBeUndefined();
    expect(
      normalizeJsonLd(
        "<script>throw new Error()</script>",
        "https://example.com",
      ),
    ).toEqual([]);
    expect(() =>
      normalizeJsonLd(
        '<script type="application/ld+json">bad</script>',
        "https://example.com",
      ),
    ).toThrow();
  });
  it("JSON-LD checks membership and expiry, handles missing and closed pages", async () => {
    const url = "https://example.com/job",
      adapter = new JsonLdUrlAdapter(htmlClient(posting));
    expect((await adapter.fetchIncremental(null, { url })).jobs).toHaveLength(
      1,
    );
    expect(await adapter.verifyListingActive(url, url)).toMatchObject({
      isActive: true,
    });
    expect(await adapter.verifyListingActive("unknown", url)).toMatchObject({
      isActive: false,
      closedReason: "ats_unlisted",
    });
    expect(
      await new JsonLdUrlAdapter(
        htmlClient({ ...posting, validThrough: "2000-01-01" }),
      ).verifyListingActive(url, url),
    ).toMatchObject({ closedReason: "expired_valid_through" });
    expect(
      await new JsonLdUrlAdapter(clientFor({}, 404)).verifyListingActive(
        url,
        url,
      ),
    ).toMatchObject({ closedReason: "http_404" });
    await expect(
      new JsonLdUrlAdapter(clientFor({}, 503)).fetchIncremental(null, { url }),
    ).rejects.toThrow("503");
    expect(new JsonLdUrlAdapter().providerName).toBe("user_url");
  });
  it.each([
    ["year", 1],
    ["month", 12],
    ["week", 52],
    ["day", 260],
    ["hour", 2080],
  ] as const)("annualizes %s transparently", (interval, multiplier) =>
    expect(annualizeCompensation(10, interval)).toBe(10 * multiplier),
  );
  it("does not annualize invalid amounts", () => {
    expect(annualizeCompensation(undefined, "year")).toBeUndefined();
    expect(annualizeCompensation(NaN, "year")).toBeUndefined();
    expect(annualizeCompensation(-1, "year")).toBeUndefined();
  });
});
describe("listing verification", () => {
  it.each([404, 410])("closes on authoritative HTTP %d", async (status) =>
    expect(
      await verifyUrlActive(
        "https://example.com",
        undefined,
        clientFor({}, status),
      ),
    ).toMatchObject({ isActive: false, httpStatus: status }),
  );
  it("does not classify outages/redirects as closure", async () => {
    await expect(
      verifyUrlActive("https://example.com", undefined, clientFor({}, 503)),
    ).rejects.toThrow();
    await expect(
      verifyUrlActive("https://example.com", undefined, clientFor({}, 302)),
    ).rejects.toThrow();
  });
  it("honors expiry, including date-only day boundary", async () => {
    const c = clientFor({});
    expect(
      await verifyUrlActive(
        "https://example.com",
        "2026-10-14",
        c,
        Date.parse("2026-10-14T20:00:00Z"),
      ),
    ).toMatchObject({ isActive: true });
    expect(
      await verifyUrlActive(
        "https://example.com",
        "2026-10-13T00:00:00Z",
        c,
        Date.parse("2026-10-14"),
      ),
    ).toMatchObject({ closedReason: "expired_valid_through" });
    await expect(
      verifyUrlActive("https://example.com", "bad", c),
    ).rejects.toThrow();
  });
});
