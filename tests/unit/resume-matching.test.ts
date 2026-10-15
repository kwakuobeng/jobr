import { describe, expect, it } from "vitest";
import { mapMatches, matchReason, mergeQueryWithChips } from "@/lib/jobs/model";
describe("resume chips → match query", () => {
  it("leaves the query untouched without approved chips", () => {
    expect(mergeQueryWithChips("  engineer ", null)).toBe("engineer");
    expect(mergeQueryWithChips("", { titles: [], skills: [] })).toBe("");
  });
  it("OR-joins quoted chips so they widen rather than AND-narrow recall", () => {
    expect(mergeQueryWithChips("", { titles: ["Software Engineer"], skills: ["TypeScript", "SQL"] })).toBe('"Software Engineer" or "TypeScript" or "SQL"');
    expect(mergeQueryWithChips("platform", { titles: ["SRE"], skills: [] })).toBe('platform or "SRE"');
  });
  it("neutralizes websearch operators and dedupes chips", () => {
    const merged = mergeQueryWithChips("", { titles: ['Dev"ops -lead'], skills: ["or", "C++", "c++", "(SQL)", "  "] });
    expect(merged).toBe('"Dev ops lead" or "C++" or "SQL"');
  });
  it("caps chip terms", () => {
    const skills = Array.from({ length: 60 }, (_, i) => `skill${i}`);
    const titles = Array.from({ length: 20 }, (_, i) => `title${i}`);
    expect(mergeQueryWithChips("", { titles, skills }).split(" or ")).toHaveLength(28);
  });
});
describe("soft match reason", () => {
  const row = { title: "Senior Software Engineer", extracted_required_skills: ["typescript", "react"], extracted_preferred_skills: ["go"] };
  it("reports title and skill overlap only", () => {
    expect(matchReason(row, { titles: ["Software Engineer", "Chef"], skills: ["TypeScript", "Go", "Rust"] })).toBe("Matches your titles: Software Engineer · Skills: TypeScript, Go");
    expect(matchReason(row, { titles: ["Chef"], skills: ["Rust"] })).toBeNull();
    expect(matchReason(row, null)).toBeNull();
  });
  it("is attached by mapMatches only when chips are provided and survives the round trip", () => {
    const rpc = [{ canonical_job_id: "11111111-1111-4111-8111-111111111111", title: "Data Engineer", employer_name: "X", workplace_type: "remote", employment_type: "full_time", extracted_required_skills: ["sql"], min_annual_salary_usd: null, max_annual_salary_usd: null, is_salary_estimated: false, canonical_posting_url: null, application_url: null, semantic_similarity: 0, lexical_rank: 0.1, rrf_score: 0.01 }];
    const [job] = mapMatches(rpc, { titles: ["Data Engineer"], skills: ["SQL"] });
    expect(job?.match_reason).toBe("Matches your titles: Data Engineer · Skills: SQL");
    expect(mapMatches(JSON.parse(JSON.stringify([job])))[0]?.match_reason).toBe(job?.match_reason);
    expect(mapMatches(rpc)[0]?.match_reason).toBeNull();
    expect(JSON.stringify(job)).not.toContain("extracted_required_skills");
  });
});
