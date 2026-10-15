import { expect, it } from "vitest";
import { workplaceBadge, locationLabel } from "@/lib/jobs/workplace-badge";
import { mapMatches } from "@/lib/jobs/model";
it.each([["remote", "Remote"], ["onsite", "Onsite"], ["hybrid", "Hybrid"], ["unspecified", "Unknown"], [null, "Unknown"], ["", "Unknown"], ["unknown", "Unknown"]])("labels %s as %s", (input, expected) => expect(workplaceBadge(input)).toBe(expected));
it("formats stored locations without dumping arbitrary JSON", () => {
  expect(locationLabel([{ city: "Austin", region: "TX", country: "US" }])).toBe("Austin, TX, US");
  expect(locationLabel(["unspecified", "Seattle, WA", "Seattle, WA"])).toBe("Seattle, WA");
  expect(locationLabel({ name: "Chicago" })).toBe("Chicago");
  expect(locationLabel({ arbitrary: "hidden" })).toBeNull();
});
it("normalizes unknown workplace and preserves location after API roundtrip", () => {
  const [job] = mapMatches([{ canonical_job_id: "11111111-1111-4111-8111-111111111111", title: "Engineer", employer_name: "Example", workplace_type: "unspecified", employment_type: "full_time", locations_json: ["Austin, TX"], min_annual_salary_usd: null, max_annual_salary_usd: null, is_salary_estimated: false, canonical_posting_url: null, application_url: null, semantic_similarity: 0, lexical_rank: 0, rrf_score: 0 }]);
  expect(job?.workplace_type).toBe("Unknown"); expect(JSON.stringify(job)).not.toContain("unspecified");
  expect(mapMatches(JSON.parse(JSON.stringify([job])))[0]?.location_label).toBe("Austin, TX");
});
