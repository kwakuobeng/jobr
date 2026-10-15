// Ported from Gemini Packet #1, adapted to main's schema names and registry format.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AshbyBoardResponseSchema,
  AtsSeedRegistrySchema,
  GreenhouseBoardResponseSchema,
  LeverPostingsResponseSchema,
  RawJobPayloadSchema,
  Tier1FixturesBundleSchema,
  USAJOBS_REQUIRED_HEADER_NAMES,
  UsaJobsResponseSchema,
  normalizeAshbyPayload,
  normalizeGreenhousePayload,
  normalizeLeverPayload,
  normalizeUsaJobsPayload,
} from "../../specs/ingestion/zod_provider_schemas";
import { normalizeGreenhouseJob } from "../../src/lib/m1_1_core";

const readJson = (rel: string): unknown =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, rel), "utf-8")) as unknown;

const fixtures = readJson("../fixtures/job_sources/tier1_fixtures.json") as Record<string, unknown>;
const registry = readJson("../../data/ats_seed_registry.json");

describe("Tier-1 provider schemas against Gemini Packet #1 fixtures", () => {
  it("validates the whole fixture bundle", () => {
    const r = Tier1FixturesBundleSchema.safeParse(fixtures);
    expect(r.error?.issues ?? []).toEqual([]);
  });

  it("Greenhouse: >= 2 jobs, one with pay ranges, normalizes via both normalizers", () => {
    const gh = GreenhouseBoardResponseSchema.parse(fixtures["greenhouse"]);
    expect(gh.jobs.length).toBeGreaterThanOrEqual(2);
    expect(gh.jobs.some((j) => (j.pay_input_ranges?.length ?? 0) > 0)).toBe(true);
    // Core normalization must satisfy the complete ingestion contract.
    const CoreShape = RawJobPayloadSchema.strict();
    for (const job of gh.jobs) {
      const item = {
        ...job,
        internal_job_id: job.internal_job_id ?? null,
        pay_input_ranges: job.pay_input_ranges?.map((r) => ({
          min_cents: r.min_cents ?? undefined,
          max_cents: r.max_cents ?? undefined,
          currency_type: r.currency_type,
        })),
      };
      const r = CoreShape.safeParse(normalizeGreenhouseJob("stripe", "Stripe", item));
      expect(r.error?.issues ?? []).toEqual([]);
    }
    const normalized = normalizeGreenhousePayload("stripe", "Stripe", "stripe.com", fixtures["greenhouse"]);
    expect(normalized.length).toBeGreaterThan(0);
    for (const p of normalized) expect(p.canonicalUrl.startsWith("https://")).toBe(true);
  });

  it("Ashby: includes an unlisted posting and the normalizer drops it", () => {
    const ashby = AshbyBoardResponseSchema.parse(fixtures["ashby"]);
    const unlisted = ashby.jobs.filter((j) => j.isListed === false);
    expect(unlisted.length).toBeGreaterThanOrEqual(1);
    const out = normalizeAshbyPayload("linear", "Linear", "linear.app", fixtures["ashby"]);
    expect(out.length).toBe(ashby.jobs.length - unlisted.length);
    for (const u of unlisted) expect(out.some((p) => p.rawTitle === u.title)).toBe(false);
  });

  it("Lever: >= 3 postings, one with a positive salaryRange, all normalize", () => {
    const lever = LeverPostingsResponseSchema.parse(fixtures["lever"]);
    expect(lever.length).toBeGreaterThanOrEqual(3);
    expect(lever.some((j) => (j.salaryRange?.min ?? 0) > 0)).toBe(true);
    expect(normalizeLeverPayload("plaid", "Plaid", "plaid.com", fixtures["lever"]).length).toBe(lever.length);
  });

  it("USAJOBS: >= 3 items incl. a remote one; header names only", () => {
    expect(USAJOBS_REQUIRED_HEADER_NAMES).toEqual(["Authorization-Key", "User-Agent"]);
    const usa = UsaJobsResponseSchema.parse(fixtures["usajobs"]);
    const items = usa.SearchResult.SearchResultItems;
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(normalizeUsaJobsPayload(fixtures["usajobs"]).some((p) => p.rawWorkplaceType === "remote")).toBe(true);
  });

  it("seed registry: valid, >= 5 boards, Tier-1 free providers only, no duplicates", () => {
    const r = AtsSeedRegistrySchema.safeParse(registry);
    expect(r.error?.issues ?? []).toEqual([]);
    expect(r.data?.employers.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("seed registry rejects unknown keys and paid/blocked providers", () => {
    const base = { canonicalName: "X", domain: "x.com", provider: "greenhouse", boardToken: "x" };
    const many = (e: object) => ({ version: "2026-10-14", employers: Array.from({ length: 5 }, (_, i) => ({ ...e, boardToken: `x${i}` })) });
    expect(AtsSeedRegistrySchema.safeParse(many({ ...base, extra: 1 })).success).toBe(false);
    for (const provider of ["jobspipe", "linkedin", "indeed", "ziprecruiter"]) {
      expect(AtsSeedRegistrySchema.safeParse(many({ ...base, provider })).success).toBe(false);
    }
    expect(AtsSeedRegistrySchema.safeParse(many(base)).success).toBe(true);
  });
});
