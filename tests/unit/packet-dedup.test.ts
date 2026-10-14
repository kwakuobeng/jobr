import { describe, it, expect } from "vitest";
import {
  dedupJob,
  checkListingActive,
  type DedupRecord,
} from "@/lib/ingestion/dedup";
import { normalizeGreenhousePayload } from "../../specs/ingestion/zod_provider_schemas";
import fixtures from "../fixtures/job_sources/tier1.json";
const job = normalizeGreenhousePayload(
  "stripe",
  "Stripe",
  undefined,
  fixtures.greenhouse,
)[0]!;
const start = "2026-10-01T00:00:00Z";
const record = (): DedupRecord =>
  dedupJob([], job, "employer", start, "one").record;
describe("Packet 2 dedup rules", () => {
  it("creates a stable new canonical record without mutating input", () => {
    const initial: DedupRecord[] = [];
    const result = dedupJob(initial, job, "employer", start, "one");
    expect(result.tier).toBe("new");
    expect(result.record.id).toBe("one");
    expect(initial).toEqual([]);
  });
  it("tier 1: exact source identity updates its sighting", () => {
    const r = dedupJob([record()], job, "employer", "2026-10-02", "two");
    expect(r.tier).toBe(1);
    expect(r.record.firstSeenAt).toBe(start);
    expect(r.records).toHaveLength(1);
    expect(r.isRepost).toBe(false);
  });
  it("tier 2: canonical apply URLs collapse trackers", () => {
    expect(
      dedupJob(
        [record()],
        {
          ...job,
          sourceProvider: "lever",
          applyUrl: job.applyUrl + "?utm_source=feed#apply",
        },
        "employer",
        start,
        "two",
      ).tier,
    ).toBe(2);
  });
  it("tier 3: identity hash links a changed external ID and URL", () =>
    expect(
      dedupJob(
        [record()],
        {
          ...job,
          externalJobId: "different",
          applyUrl: "https://example.com/new",
        },
        "employer",
        start,
        "two",
      ).tier,
    ).toBe(3));
  it("tier 4: punctuation-normalized location and employer match within 30 days", () => {
    const variant = {
      ...job,
      externalJobId: "different",
      applyUrl: "https://example.com/new",
      rawEmployerName: "STRIPE",
      rawLocations: ["San Francisco CA Hybrid"],
    };
    expect(
      dedupJob([record()], variant, "employer", "2026-10-31", "two").tier,
    ).toBe(4);
    expect(
      dedupJob([record()], variant, "employer", "2026-11-01", "two").tier,
    ).toBe("new");
  });
  it("does not fuzzy-match unrelated titles or future sightings", () => {
    const variant = {
      ...job,
      externalJobId: "different",
      applyUrl: "https://example.com/new",
      rawTitle: "Artist",
      rawLocations: ["TX"],
    };
    expect(dedupJob([record()], variant, "other", start, "two").tier).toBe(
      "new",
    );
    expect(
      dedupJob(
        [record()],
        {
          ...variant,
          rawTitle: job.rawTitle,
          rawLocations: ["San Francisco CA Hybrid"],
        },
        "other",
        "2026-09-01",
        "two",
      ).tier,
    ).toBe("new");
  });
  it("detects a new requisition ID after more than seven days as a repost", () => {
    const variant = {
      ...job,
      externalJobId: "different",
      applyUrl: "https://example.com/new",
    };
    const r = dedupJob([record()], variant, "employer", "2026-10-09", "two");
    expect(r.isRepost).toBe(true);
    expect(r.record.repostCount).toBe(1);
    expect(r.record.firstSeenAt).toBe(start);
    expect(
      dedupJob(r.records, variant, "employer", "2026-10-20", "three").isRepost,
    ).toBe(false);
  });
  it("does not mark exactly seven days or an unchanged ID as a repost", () => {
    expect(
      dedupJob(
        [record()],
        { ...job, externalJobId: "different" },
        "employer",
        "2026-10-08",
        "two",
      ).isRepost,
    ).toBe(false);
    expect(
      dedupJob([record()], job, "employer", "2026-10-20", "two").isRepost,
    ).toBe(false);
  });
  it("rejects invalid dates or a changed employer on a source identity", () => {
    expect(() => dedupJob([record()], job, "employer", "bad", "two")).toThrow();
    expect(() => dedupJob([record()], job, "other", start, "two")).toThrow(
      "employer",
    );
  });
  it("checks active listings with GET and does not treat outages as closure", async () => {
    const http = async () => ({
      status: 200,
      headers: {},
      text: "ok",
      url: job.applyUrl,
    });
    expect(await checkListingActive(job.applyUrl, http)).toBe(true);
    for (const status of [404, 410])
      expect(
        await checkListingActive(job.applyUrl, async () => ({
          ...(await http()),
          status,
        })),
      ).toBe(false);
    await expect(
      checkListingActive(job.applyUrl, async () => ({
        ...(await http()),
        status: 503,
      })),
    ).rejects.toThrow("inconclusive");
  });
});
