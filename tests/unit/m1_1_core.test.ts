import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  calculateNonOverlappingExperience,
  computeCanonicalIdentityHash,
  normalizeGreenhouseJob,
  verifyResumeQuoteSubstring,
  type DateIntervalInput,
  type GreenhouseJobItem,
} from "@/lib/m1_1_core";

const role = (
  id: string,
  startDate: string,
  endDate: string | null,
  opts: Partial<Pick<DateIntervalInput, "isCurrent" | "isInternship">> = {},
): DateIntervalInput => ({
  id,
  startDate,
  endDate,
  isCurrent: opts.isCurrent ?? false,
  isInternship: opts.isInternship ?? false,
});

describe("calculateNonOverlappingExperience", () => {
  it("counts a single role inclusively by month", () => {
    const r = calculateNonOverlappingExperience([
      role("a", "2020-01-01", "2020-12-31"),
    ]);
    expect(r.totalProfessionalMonths).toBe(12);
    expect(r.mergedIntervals).toHaveLength(1);
  });

  it("merges overlapping roles without double counting", () => {
    const r = calculateNonOverlappingExperience([
      role("a", "2020-01-01", "2021-06-30"),
      role("b", "2021-01-01", "2021-12-31"),
    ]);
    expect(r.totalProfessionalMonths).toBe(24);
    expect(r.mergedIntervals).toHaveLength(1);
  });

  it("merges a fully nested role", () => {
    const r = calculateNonOverlappingExperience([
      role("outer", "2018-01-01", "2020-12-01"),
      role("inner", "2019-03-01", "2019-09-01"),
    ]);
    expect(r.totalProfessionalMonths).toBe(36);
  });

  it("keeps disjoint roles separate and is order-independent", () => {
    const input = [
      role("b", "2022-01-01", "2022-06-01"),
      role("a", "2020-01-01", "2020-06-01"),
    ];
    const r = calculateNonOverlappingExperience(input);
    expect(r.totalProfessionalMonths).toBe(12);
    expect(r.mergedIntervals).toHaveLength(2);
    expect(r.mergedIntervals[0]?.startMonthIndex).toBeLessThan(
      r.mergedIntervals[1]?.startMonthIndex ?? 0,
    );
  });

  it("merges roles sharing a boundary month", () => {
    const r = calculateNonOverlappingExperience([
      role("a", "2020-01-01", "2020-06-15"),
      role("b", "2020-06-20", "2020-12-01"),
    ]);
    expect(r.totalProfessionalMonths).toBe(12);
  });

  it("separates internships from professional experience", () => {
    const r = calculateNonOverlappingExperience([
      role("i", "2019-06-01", "2019-08-31", { isInternship: true }),
      role("p", "2020-01-01", "2020-12-31"),
    ]);
    expect(r.totalProfessionalMonths).toBe(12);
    expect(r.totalInternshipMonths).toBe(3);
    expect(r.mergedIntervals).toHaveLength(1);
  });

  it("uses the reference date for isCurrent and null endDate", () => {
    const current = calculateNonOverlappingExperience(
      [role("c", "2026-01-01", "2026-03-01", { isCurrent: true })],
      "2026-10-14",
    );
    expect(current.totalProfessionalMonths).toBe(10);
    const open = calculateNonOverlappingExperience(
      [role("o", "2025-10-01", null)],
      "2026-10-14",
    );
    expect(open.totalProfessionalMonths).toBe(13);
  });

  it("returns zeros for empty input", () => {
    const r = calculateNonOverlappingExperience([]);
    expect(r).toEqual({
      totalProfessionalMonths: 0,
      totalInternshipMonths: 0,
      mergedIntervals: [],
    });
  });

  it("throws on invalid dates", () => {
    expect(() =>
      calculateNonOverlappingExperience([role("x", "2020-13-01", null)]),
    ).toThrow(/Invalid ISO date/);
    expect(() =>
      calculateNonOverlappingExperience([role("x", "garbage", null)]),
    ).toThrow(/Invalid ISO date/);
    expect(() => calculateNonOverlappingExperience([], "bad")).toThrow(
      /Invalid ISO date/,
    );
  });
});

describe("verifyResumeQuoteSubstring", () => {
  const resume =
    "Led migration of   payments\nplatform to Kubernetes,\treducing cost by 30%.";

  it("rejects whitespace-normalized paraphrases", () => {
    expect(
      verifyResumeQuoteSubstring(
        resume,
        "migration of payments platform to Kubernetes",
      ),
    ).toBe(false);
    expect(verifyResumeQuoteSubstring(resume, "  reducing cost by 30%. ")).toBe(
      false,
    );
  });

  it("accepts short exact quotes but rejects empty ones", () => {
    expect(verifyResumeQuoteSubstring(resume, "Led")).toBe(true);
    expect(verifyResumeQuoteSubstring(resume, "     ")).toBe(false);
  });

  it("rejects absent or paraphrased quotes", () => {
    expect(
      verifyResumeQuoteSubstring(resume, "Migrated payments to Kubernetes"),
    ).toBe(false);
  });

  it("is case-sensitive (exact substring)", () => {
    expect(
      verifyResumeQuoteSubstring(resume, "led migration of payments"),
    ).toBe(false);
  });
});

describe("computeCanonicalIdentityHash", () => {
  it("is a sha256 hex of the normalized identity tuple", () => {
    const expected = crypto
      .createHash("sha256")
      .update("emp-1|senior-software-engineer|austin, tx,remote")
      .digest("hex");
    expect(
      computeCanonicalIdentityHash("emp-1", "Senior Software Engineer", [
        "Remote",
        "Austin, TX",
      ]),
    ).toBe(expected);
  });

  it("is stable under location order, case and surrounding whitespace", () => {
    const a = computeCanonicalIdentityHash("emp-1", "Engineer", [
      "Austin, TX",
      "Remote",
    ]);
    const b = computeCanonicalIdentityHash("emp-1", "Engineer", [
      "  remote ",
      "AUSTIN, TX",
    ]);
    expect(a).toBe(b);
  });

  it("is stable under title case and punctuation", () => {
    const a = computeCanonicalIdentityHash(
      "emp-1",
      "Sr. Engineer (Backend)",
      [],
    );
    const b = computeCanonicalIdentityHash("emp-1", "sr engineer backend", []);
    expect(a).toBe(b);
  });

  it("differs by employer and title", () => {
    const base = computeCanonicalIdentityHash("emp-1", "Engineer", ["Remote"]);
    expect(
      computeCanonicalIdentityHash("emp-2", "Engineer", ["Remote"]),
    ).not.toBe(base);
    expect(
      computeCanonicalIdentityHash("emp-1", "Designer", ["Remote"]),
    ).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeGreenhouseJob", () => {
  const item: GreenhouseJobItem = {
    id: 4012345,
    internal_job_id: 99,
    title: "Staff Engineer",
    updated_at: "2026-10-01T12:00:00-04:00",
    absolute_url: "https://boards.greenhouse.io/acme/jobs/4012345",
    location: { name: "Chicago, IL" },
    content:
      "<p>Build <strong>things</strong></p>\n<ul><li>TypeScript</li></ul>",
    pay_input_ranges: [
      { min_cents: 18000050, max_cents: 22000000, currency_type: "USD" },
    ],
  };

  it("maps core fields", () => {
    const n = normalizeGreenhouseJob("acme", "Acme Inc", item);
    expect(n).toMatchObject({
      sourceProvider: "greenhouse",
      sourceTenantSlug: "acme",
      externalJobId: "4012345",
      canonicalUrl: item.absolute_url,
      applyUrl: item.absolute_url,
      rawTitle: "Staff Engineer",
      rawEmployerName: "Acme Inc",
      rawLocations: ["Chicago, IL"],
      updatedAt: item.updated_at,
    });
  });

  it("strips HTML into plain text and keeps raw HTML", () => {
    const n = normalizeGreenhouseJob("acme", "Acme", item);
    expect(n.rawDescriptionText).toBe("Build things TypeScript");
    expect(n.rawDescriptionHtml).toBe(item.content);
  });

  it("preserves cents in currency units", () => {
    const n = normalizeGreenhouseJob("acme", "Acme", item);
    expect(n.rawCompensation).toEqual({
      currency: "USD",
      interval: "year",
      minAmount: 180000.5,
      maxAmount: 220000,
    });
  });

  it("handles missing location, content and pay", () => {
    const n = normalizeGreenhouseJob("acme", "Acme", {
      id: 1,
      internal_job_id: null,
      title: "X",
      updated_at: "2026-01-01T00:00:00Z",
      absolute_url: "https://example.test/1",
    });
    expect(n.rawLocations).toEqual([]);
    expect(n.rawDescriptionText).toBe("");
    expect(n.rawCompensation).toBeUndefined();
  });

  it("defaults currency to USD when absent", () => {
    const n = normalizeGreenhouseJob("acme", "Acme", {
      ...item,
      pay_input_ranges: [{ min_cents: 10000000 }],
    });
    expect(n.rawCompensation).toEqual({
      currency: "USD",
      interval: "year",
      minAmount: 100000,
      maxAmount: undefined,
    });
  });

  it("preserves a zero-cent bound", () => {
    const n = normalizeGreenhouseJob("acme", "Acme", {
      ...item,
      pay_input_ranges: [{ min_cents: 0, max_cents: 5000000 }],
    });
    expect(n.rawCompensation?.minAmount).toBe(0);
  });
});
