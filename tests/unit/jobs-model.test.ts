import { describe, expect, it } from "vitest";
import { FeedRequest, PreferencesRequest } from "../../specs/api/contracts";
import { mapMatches, PreferencesInput, sourceUrl } from "@/lib/jobs/model";
export const preferences = {
  candidate_profile_id: "11111111-1111-4111-8111-111111111111", excluded_employer_ids: [], excluded_tech_slugs: [],
  allowed_workplace_types: ["remote"], allowed_employment_types: ["full_time"], hard_min_annual_salary_usd: null,
  allow_undisclosed_salary: true, requires_visa_sponsorship: false, max_commute_miles: null,
};
describe("jobs UI contracts", () => {
  it("accepts nullable salary/commute and rejects invalid filter sets", () => {
    expect(PreferencesRequest.safeParse(preferences).success).toBe(true);
    expect(PreferencesRequest.safeParse({ ...preferences, allowed_workplace_types: [] }).success).toBe(false);
    expect(PreferencesInput.safeParse({ ...preferences, max_commute_miles: 1.5 }).success).toBe(false);
    expect(PreferencesInput.safeParse({ ...preferences, max_commute_miles: 501 }).success).toBe(false);
    expect(PreferencesInput.safeParse({ ...preferences, hard_min_annual_salary_usd: 2147483648 }).success).toBe(false);
  });
  it("enforces feed bounds and strict fields", () => {
    const input = { candidate_profile_id: preferences.candidate_profile_id, query: "", include_stretch_exceptions: false, limit: 20 };
    expect(FeedRequest.safeParse(input).success).toBe(true);
    expect(FeedRequest.safeParse({ ...input, limit: 51 }).success).toBe(false);
    expect(FeedRequest.safeParse({ ...input, user_id: "forged" }).success).toBe(false);
  });
  it("handles empty real results without fabricating jobs", () => expect(mapMatches([])).toEqual([]));
  it("maps RPC rows and removes unsafe source links", () => {
    const [job] = mapMatches([{ canonical_job_id: preferences.candidate_profile_id, title: "Engineer", employer_name: "Example",
      workplace_type: "remote", employment_type: "full_time", min_annual_salary_usd: null, max_annual_salary_usd: 100000,
      is_salary_estimated: false, canonical_posting_url: "javascript:alert(1)", application_url: "https://jobs.example.com/apply",
      semantic_similarity: 0, lexical_rank: 0.5, rrf_score: 0.01, extra_rpc_field: "ignored" }]);
    expect(job?.canonical_posting_url).toBeNull(); expect(job?.application_url).toBe("https://jobs.example.com/apply");
    expect(job?.lexical_rank).toBe(0.5);
    expect(sourceUrl("https://user:password@example.com")).toBeNull();
  });
});
