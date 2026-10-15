import { describe, expect, it } from "vitest";
import { workplaceBadge, locationLabel, locationTextParts } from "@/lib/jobs/workplace-badge";
import { mapMatches } from "@/lib/jobs/model";
const base = { canonical_job_id: "11111111-1111-4111-8111-111111111111", title: "Engineer", employer_name: "Example", workplace_type: "unspecified", employment_type: "full_time", locations_json: ["Austin, TX"], min_annual_salary_usd: null, max_annual_salary_usd: null, is_salary_estimated: false, canonical_posting_url: null, application_url: null, semantic_similarity: 0, lexical_rank: 0, rrf_score: 0 };
it.each([["remote", "Remote"], ["onsite", "Onsite"], ["hybrid", "Hybrid"], ["unspecified", "Unknown"], [null, "Unknown"], ["", "Unknown"], ["unknown", "Unknown"]])("labels %s as %s", (input, expected) => expect(workplaceBadge(input).label).toBe(expected));
describe("display-only soft inference for unspecified workplace", () => {
  it("never overrides an explicit stored enum", () => {
    expect(workplaceBadge("onsite", { title: "Remote Engineer" })).toEqual({ label: "Onsite", inferred: false });
    expect(workplaceBadge("remote", { title: "Hybrid Engineer" })).toEqual({ label: "Remote", inferred: false });
  });
  it.each([
    [{ title: "Senior Engineer (Hybrid)" }, "Hybrid"],
    [{ title: "Engineer", locations_json: ["Remote - US"] }, "Remote"],
    [{ title: "Engineer", locations_json: ["Remote or hybrid, Chicago"] }, "Hybrid"],
    [{ title: "Support Agent - Work From Home" }, "Remote"],
    [{ title: "Analyst", locations_json: [{ name: "Anywhere" }] }, "Remote"],
    [{ title: "IT Specialist", description: "This position is telework eligible." }, "Remote"],
    [{ title: "Technician", locations_json: ["On-site, Denver, CO"] }, "Onsite"],
    [{ title: "Nurse (onsite)" }, "Onsite"],
    [{ title: "Clerk", locations_json: ["In-office Monday-Friday"] }, "Onsite"],
    [{ title: "Engineer", locations_json: [{ RemoteIndicator: true }] }, "Remote"],
    [{ title: "Engineer", locations_json: [{ details: { TeleworkEligible: true } }] }, "Remote"],
  ])("infers %j as %s (marked inferred)", (context, label) => expect(workplaceBadge("unspecified", context)).toEqual({ label, inferred: true }));
  it("stays Unknown without a signal and ignores false flags", () => {
    expect(workplaceBadge(null, { title: "Engineer", locations_json: ["Austin, TX"] })).toEqual({ label: "Unknown", inferred: false });
    expect(workplaceBadge("unspecified", { locations_json: [{ RemoteIndicator: false, TeleworkEligible: false }] })).toEqual({ label: "Unknown", inferred: false });
    expect(workplaceBadge("unspecified", { title: "Remoteness analyst" }).label).toBe("Unknown");
    expect(workplaceBadge("unspecified")).toEqual({ label: "Unknown", inferred: false });
  });
  it("walks bounded nested location shapes only", () => {
    expect(locationTextParts([{ city: "Austin", nested: [{ name: "Remote" }] }, 5, null])).toEqual(["Austin", "Remote"]);
    let deep: unknown = "Remote"; for (let i = 0; i < 10; i++) deep = [deep];
    expect(locationTextParts(deep)).toEqual([]);
  });
});
it("formats stored locations without dumping arbitrary JSON", () => {
  expect(locationLabel([{ city: "Austin", region: "TX", country: "US" }])).toBe("Austin, TX, US");
  expect(locationLabel(["unspecified", "Seattle, WA", "Seattle, WA"])).toBe("Seattle, WA");
  expect(locationLabel({ name: "Chicago" })).toBe("Chicago");
  expect(locationLabel({ arbitrary: "hidden" })).toBeNull();
});
it("normalizes unknown workplace and preserves location after API roundtrip", () => {
  const [job] = mapMatches([base]);
  expect(job?.workplace_type).toBe("Unknown"); expect(job?.workplace_inferred).toBe(false); expect(JSON.stringify(job)).not.toContain("unspecified");
  expect(mapMatches(JSON.parse(JSON.stringify([job])))[0]?.location_label).toBe("Austin, TX");
});
it("keeps the inferred marker across the server → client mapMatches round trip", () => {
  const [job] = mapMatches([{ ...base, locations_json: ["Remote (US)"] }]);
  expect(job).toMatchObject({ workplace_type: "Remote", workplace_inferred: true });
  const [again] = mapMatches(JSON.parse(JSON.stringify([job])));
  expect(again).toMatchObject({ workplace_type: "Remote", workplace_inferred: true, location_label: "Remote (US)" });
});
