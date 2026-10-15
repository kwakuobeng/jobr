import { describe, it, expect } from "vitest";
import {
  deduplicate,
  normalizeApplyUrl,
  jaccard,
  simhash,
  hamming,
  shouldSuppressRecommendation,
  type DedupState,
} from "@/lib/ingestion/deduplicator";
import { normalizeGreenhousePayload } from "../../specs/ingestion/zod_provider_schemas";
import fixtures from "../fixtures/job_sources/tier1.json";
const job = normalizeGreenhousePayload(
  "stripe",
  "Stripe",
  undefined,
  fixtures.greenhouse,
)[0]!;
const empty: DedupState = { jobs: [], events: [] },
  now = "2026-10-14T00:00:00Z";
describe("four-tier deduplication", () => {
  it("creates new records then idempotently updates exact source sightings", () => {
    const one = deduplicate(empty, job, "e", now, "1");
    const two = deduplicate(one.state, job, "e", now, "2");
    expect(one.tier).toBe("new");
    expect(two.tier).toBe(1);
    expect(two.state.jobs).toHaveLength(1);
    expect(two.state.events).toHaveLength(1);
    expect(empty.jobs).toEqual([]);
  });
  it("merges cross-provider canonical URLs, preserving two events", () => {
    const one = deduplicate(empty, job, "e", now, "1");
    const two = deduplicate(
      one.state,
      {
        ...job,
        sourceProvider: "lever",
        applyUrl: job.applyUrl + "?utm_source=feed",
      },
      "e",
      now,
      "2",
    );
    expect(two.tier).toBe(2);
    expect(two.state.events).toHaveLength(2);
    expect(two.job.id).toBe("1");
  });
  it("composite hash plus description merges different URLs", () => {
    const one = deduplicate(empty, job, "e", now, "1");
    const two = deduplicate(
      one.state,
      { ...job, externalJobId: "2", applyUrl: "https://example.com/2" },
      "e",
      now,
      "2",
    );
    expect(two.tier).toBe(3);
  });
  it("detects closed reposts without resetting original publication", () => {
    const one = deduplicate(empty, job, "e", now, "1");
    const state = {
      ...one.state,
      jobs: [{ ...one.job, status: "closed" as const, repostCount: 2 }],
    };
    const two = deduplicate(
      state,
      { ...job, externalJobId: "2", applyUrl: "https://example.com/2" },
      "e",
      now,
      "2",
    );
    expect(two.tier).toBe(4);
    expect(two.job.repostCount).toBe(3);
    expect(two.job.originalPublishedAt).toBe(one.job.originalPublishedAt);
    expect(two.job.ghostRiskScore).toBe(0.8);
  });
  it("reactivates same source and URL as reposts once", () => {
    const one = deduplicate(empty, job, "e", now, "1");
    const state = {
      ...one.state,
      jobs: [{ ...one.job, status: "closed" as const }],
    };
    const two = deduplicate(state, job, "e", now, "2");
    expect(two.tier).toBe(4);
    expect(deduplicate(two.state, job, "e", now, "3").job.repostCount).toBe(1);
  });
  it("does not merge different descriptions or employers", () => {
    const one = deduplicate(empty, job, "e", now, "1");
    expect(
      deduplicate(
        one.state,
        {
          ...job,
          externalJobId: "x",
          applyUrl: "https://example.com/x",
          rawDescriptionText: "Painting fine art portraits with oils",
        },
        "e",
        now,
        "2",
      ).tier,
    ).toBe("new");
    expect(() => deduplicate(one.state, job, "other", now, "2")).toThrow(
      "employer identity",
    );
    expect(
      deduplicate(
        one.state,
        { ...job, sourceTenantSlug: "other" },
        "other",
        now,
        "2",
      ).tier,
    ).toBe("new");
  });
  it("does not fuzzy-merge old active jobs, flags aged listings", () => {
    const one = deduplicate(
      empty,
      { ...job, publishedAt: "2026-01-01" },
      "e",
      "2026-01-02",
      "1",
    );
    expect(one.job.ghostRiskScore).toBe(0);
    const two = deduplicate(
      one.state,
      { ...job, externalJobId: "2", applyUrl: "https://example.com/2" },
      "e",
      now,
      "2",
    );
    expect(two.tier).toBe("new");
    const old = deduplicate(
      empty,
      { ...job, publishedAt: "2026-01-01" },
      "e",
      now,
      "1",
    );
    expect(old.job.ghostRiskScore).toBe(0.8);
  });
  it("rejects orphan sightings and invalid time", () => {
    expect(() =>
      deduplicate(
        {
          jobs: [],
          events: [
            {
              sourceKey: JSON.stringify([
                "greenhouse",
                "stripe",
                job.externalJobId,
              ]),
              canonicalJobId: "missing",
              lastSeenAt: now,
            },
          ],
        },
        job,
        "e",
        now,
        "1",
      ),
    ).toThrow();
    expect(() => deduplicate(empty, job, "e", "bad", "1")).toThrow();
  });
  it("handles missing and future publication dates", () => {
    expect(
      deduplicate(empty, { ...job, publishedAt: undefined }, "e", now, "1").job
        .originalPublishedAt,
    ).toBe(now);
    expect(
      deduplicate(empty, { ...job, publishedAt: "2030-01-01" }, "e", now, "1")
        .job.originalPublishedAt,
    ).toBe(new Date(now).toISOString());
  });
  it("normalizes tracking parameters without discarding identity parameters", () => {
    expect(
      normalizeApplyUrl(
        "https://example.com/jobs/1/?utm_source=a&gh_src=b&lever-source=c&ref=x&id=1#x",
      ),
    ).toBe("https://example.com/jobs/1?id=1");
    expect(() => normalizeApplyUrl("http://example.com")).toThrow();
    expect(() => normalizeApplyUrl("https://u:p@example.com")).toThrow();
  });
  it("similarity handles empty and unicode descriptions", () => {
    expect(jaccard("", "")).toBe(0);
    expect(jaccard("hello world", "hello there")).toBeCloseTo(1 / 3);
    expect(jaccard("Développeur cloud", "développeur cloud")).toBe(1);
    expect(hamming(simhash("hello world"), simhash("world hello"))).toBe(0);
    expect(hamming(0n, 3n)).toBe(2);
  });
  it("suppresses user memory by canonical ID or identity unless reevaluated or salary rises 10%", () => {
    const decision = {
      canonicalJobId: "1",
      identityHash: "hash",
      salaryAtDecision: 100,
    };
    expect(
      shouldSuppressRecommendation(decision, { id: "2", identityHash: "hash" }),
    ).toBe(true);
    expect(
      shouldSuppressRecommendation(decision, {
        id: "1",
        identityHash: "other",
        salary: 109,
      }),
    ).toBe(true);
    expect(
      shouldSuppressRecommendation(decision, {
        id: "1",
        identityHash: "hash",
        salary: 111,
      }),
    ).toBe(false);
    expect(
      shouldSuppressRecommendation(decision, {
        id: "2",
        identityHash: "other",
      }),
    ).toBe(false);
    expect(
      shouldSuppressRecommendation(
        decision,
        { id: "1", identityHash: "hash" },
        true,
      ),
    ).toBe(false);
  });
});

describe("signed int64 simhash (QA bug 2)", () => {
  const INT64_MIN = -(1n << 63n), INT64_MAX = (1n << 63n) - 1n;
  const words = Array.from({ length: 400 }, (_, i) => `token${i}`);
  it("always fits Postgres BIGINT", () => {
    for (let i = 0; i < 200; i++) {
      const h = simhash(words.slice(i, i + 40).join(" "));
      expect(h >= INT64_MIN && h <= INT64_MAX).toBe(true);
    }
  });
  it("produces high-bit (negative) values for some inputs", () => {
    const hs = Array.from({ length: 200 }, (_, i) => simhash(words.slice(i, i + 40).join(" ")));
    expect(hs.some((h) => h < 0n)).toBe(true);
    expect(hs.some((h) => h >= 0n)).toBe(true);
  });
  it("hamming works on signed values, including the sign bit", () => {
    expect(hamming(-1n, 0n)).toBe(64);
    expect(hamming(INT64_MIN, 0n)).toBe(1);
    expect(hamming(INT64_MIN, INT64_MAX)).toBe(64);
    expect(hamming(-1n, -2n)).toBe(1);
    expect(hamming(-5n, -5n)).toBe(0);
  });
  it("hamming(signed) equals hamming of the unsigned representation", () => {
    const hs = Array.from({ length: 50 }, (_, i) => simhash(words.slice(i * 3, i * 3 + 30).join(" ")));
    for (let i = 1; i < hs.length; i++) {
      const a = hs[i - 1]!, b = hs[i]!;
      expect(hamming(a, b)).toBe(hamming(BigInt.asUintN(64, a), BigInt.asUintN(64, b)));
    }
  });
});
