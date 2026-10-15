import { describe, expect, it } from "vitest";
import { companyOrigin, daysSince, explainFit, haversineMiles, jobRegion, mapMatches, matchScore, mergeQueryWithChips, phraseQuery, postedLabel, sortMatches, titleMatches, usOrRemote, zipToPoint } from "@/lib/jobs/model";

describe("phrase queries", () => {
  it("quotes a typed multi-word role so tokens must be adjacent", () => {
    expect(phraseQuery("account executive")).toBe('"account executive"');
    expect(phraseQuery('"account executive"')).toBe('"account executive"');
    expect(phraseQuery("sales")).toBe("sales");
    expect(phraseQuery("ae or sdr")).toBe("ae or sdr");
    expect(mergeQueryWithChips("account executive", { titles: ["Sales Analyst"], skills: [] })).toBe('"account executive" or "Sales Analyst"');
  });
});
describe("title and location filters", () => {
  it("matches title keywords as whole words, title only", () => {
    expect(titleMatches("Enterprise Account Executive, SLED", ["account executive"])).toBe(true);
    expect(titleMatches("Sales Development Representative", ["account executive"])).toBe(false);
    expect(titleMatches("Senior Business Development Manager", ["account executive", "business development"])).toBe(true);
    expect(titleMatches("Salesforce Admin", ["sales"])).toBe(false);
    expect(titleMatches("Anything", [])).toBe(true);
  });
  it("classifies region by stated location, including remote", () => {
    expect(jobRegion({ locations_json: ["Remote - US"] })).toBe("us");
    expect(jobRegion({ locations_json: [{ city: "Dallas", region: "TX" }], location_label: "Dallas, TX" })).toBe("us");
    expect(jobRegion({ locations_json: ["Remote - Sweden"] })).toBe("non_us");
    expect(jobRegion({ locations_json: ["London, United Kingdom"] })).toBe("non_us");
    expect(jobRegion({ locations_json: ["Remote"] })).toBe("unknown");
  });
  it("US-or-remote: unknown workplace passes only with US location text", () => {
    expect(usOrRemote({ workplace_type: "unspecified", locations_json: ["Austin, TX"] })).toBe(true);
    expect(usOrRemote({ workplace_type: "unspecified", locations_json: ["Somewhere"] })).toBe(false);
    expect(usOrRemote({ workplace_type: "remote", locations_json: ["Remote"] })).toBe(true);
    expect(usOrRemote({ workplace_type: "remote", locations_json: ["Remote - Germany"] })).toBe(false);
    expect(usOrRemote({ workplace_type: "onsite", locations_json: ["Toronto, Canada"] })).toBe(false);
  });
  it("labels company origin honestly as a posting-location inference", () => {
    expect(companyOrigin("us").label).toBe("US posting"); expect(companyOrigin("non_us").label).toBe("Non-US posting"); expect(companyOrigin("unknown").label).toBe("Origin unknown");
  });
});
describe("distance, recency, score and sorting", () => {
  it("looks up ZIPs offline and computes great-circle miles", () => {
    const dallas = zipToPoint("75201")!; const austin = zipToPoint("78701")!;
    expect(dallas).not.toBeNull(); expect(zipToPoint("00000")).toBeNull(); expect(zipToPoint("abc")).toBeNull();
    expect(haversineMiles(dallas, austin)).toBeGreaterThan(150); expect(haversineMiles(dallas, austin)).toBeLessThan(230);
  });
  it("formats posted age", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(daysSince("2026-10-10T12:00:00Z", now)).toBe(5); expect(postedLabel(5)).toBe("Posted 5 days ago"); expect(postedLabel(null)).toBeNull(); expect(postedLabel(0)).toBe("Posted today");
  });
  it("maps scores deterministically into 1-10", () => {
    expect(matchScore({ rrf: 0.03, minRrf: 0.01, maxRrf: 0.03, titleHit: true, salaryOk: true, workplaceOk: true })).toBe(10);
    expect(matchScore({ rrf: 0.01, minRrf: 0.01, maxRrf: 0.03, titleHit: false, salaryOk: false, workplaceOk: false })).toBe(1);
    expect(matchScore({ rrf: 0.02, minRrf: 0.01, maxRrf: 0.03, titleHit: false, salaryOk: true, workplaceOk: false })).toBe(5);
    expect(matchScore({ rrf: 0.02, minRrf: 0.02, maxRrf: 0.02, titleHit: false, salaryOk: false, workplaceOk: false })).toBe(7);
  });
  it("explains fit in plain words", () => {
    expect(explainFit({ title: "Enterprise Account Executive", lexical_rank: 0.2, semantic_similarity: 0.4 }, '"account executive"').keyword_text).toMatch(/^Keyword fit: strong, your search words appear in the title/);
    const f = explainFit({ title: "SDR", lexical_rank: 0.1, semantic_similarity: 0 }, "account executive");
    expect(f.keyword).toBe("moderate"); expect(f.semantic_text).toMatch(/not available/);
  });
  const base = { employer_name: "X", employment_type: "full_time", is_salary_estimated: false, canonical_posting_url: null, application_url: null, semantic_similarity: 0, lexical_rank: 0.1 };
  const rows = [
    { ...base, canonical_job_id: "11111111-1111-4111-8111-111111111111", title: "Account Executive", workplace_type: "onsite", min_annual_salary_usd: 90000, max_annual_salary_usd: 120000, rrf_score: 0.03, latitude: 30.27, longitude: -97.74, original_published_at: "2026-10-01T00:00:00Z", locations_json: ["Austin, TX"] },
    { ...base, canonical_job_id: "22222222-2222-4222-8222-222222222222", title: "Senior Account Executive", workplace_type: "remote", min_annual_salary_usd: null, max_annual_salary_usd: null, rrf_score: 0.02, first_discovered_at: "2026-10-14T00:00:00Z", locations_json: ["Remote - US"] },
    { ...base, canonical_job_id: "33333333-3333-4333-8333-333333333333", title: "Enterprise AE", workplace_type: "hybrid", min_annual_salary_usd: 150000, max_annual_salary_usd: 200000, rrf_score: 0.01, locations_json: ["Dallas, TX 75201"] },
  ];
  const mapped = mapMatches(rows, null, { query: "account executive", salary_floor: 100000, allowed_workplaces: ["remote", "hybrid"], origin: { zip: "75201", point: zipToPoint("75201")! }, now: Date.parse("2026-10-15T12:00:00Z") });
  it("enriches cards with distance (or 'Distance unknown'), posted label, origin and score", () => {
    expect(mapped[0]!.distance_label).toMatch(/mi from 75201$/); expect(mapped[1]!.distance_label).toBe("Distance unknown"); expect(mapped[2]!.distance_miles).toBe(0);
    expect(mapped[0]!.posted_label).toBe("Posted 14 days ago"); expect(mapped[1]!.posted_label).toBe("Posted 1 day ago"); expect(mapped[2]!.posted_label).toBeNull();
    expect(mapped.map((m) => m.company_origin)).toEqual(["US posting", "US posting", "US posting"]);
    expect(mapped[0]!.match_score).toBe(10); expect(mapped.every((m) => m.match_score >= 1 && m.match_score <= 10)).toBe(true);
  });
  it("sorts by each key with unknowns last and stable best-match ties", () => {
    const ids = (xs: typeof mapped) => xs.map((m) => m.title);
    expect(ids(sortMatches(mapped, "best"))).toEqual(["Account Executive", "Senior Account Executive", "Enterprise AE"]);
    expect(ids(sortMatches(mapped, "workplace"))).toEqual(["Senior Account Executive", "Enterprise AE", "Account Executive"]);
    expect(ids(sortMatches(mapped, "workplace", ["Onsite", "Hybrid", "Remote"]))).toEqual(["Account Executive", "Enterprise AE", "Senior Account Executive"]);
    expect(ids(sortMatches(mapped, "distance"))).toEqual(["Enterprise AE", "Account Executive", "Senior Account Executive"]);
    expect(ids(sortMatches(mapped, "compensation"))).toEqual(["Enterprise AE", "Account Executive", "Senior Account Executive"]);
    expect(ids(sortMatches(mapped, "newest"))).toEqual(["Senior Account Executive", "Account Executive", "Enterprise AE"]);
  });
});
