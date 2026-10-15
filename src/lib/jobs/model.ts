import { z } from "zod";
import { locationLabel, workplaceBadge } from "./workplace-badge";
import { PreferencesRequest } from "../../../specs/api/contracts";

export type Preferences = z.infer<typeof PreferencesRequest>;
export const preferenceColumns = Object.keys(PreferencesRequest.shape).join(",");
export const PreferencesInput = PreferencesRequest.superRefine((value, context) => {
  if (value.max_commute_miles !== null && (!Number.isInteger(value.max_commute_miles) || value.max_commute_miles > 500))
    context.addIssue({ code: "custom", path: ["max_commute_miles"], message: "Commute must be a whole number from 0 to 500 miles." });
  if (value.hard_min_annual_salary_usd !== null && value.hard_min_annual_salary_usd > 2147483647)
    context.addIssue({ code: "custom", path: ["hard_min_annual_salary_usd"], message: "Salary exceeds the supported database range." });
});
const RpcRow = z.object({
  canonical_job_id: z.string().uuid(), title: z.string(), employer_name: z.string(),
  workplace_type: z.string().nullish(), locations_json: z.unknown().optional(), location_label: z.string().nullish(), employment_type: z.string(),
  min_annual_salary_usd: z.number().nullable(), max_annual_salary_usd: z.number().nullable(),
  is_salary_estimated: z.boolean(), canonical_posting_url: z.string().nullable(), application_url: z.string().nullable(),
  semantic_similarity: z.number(), lexical_rank: z.number(), rrf_score: z.number(),
});
export function sourceUrl(value: string | null): string | null {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function mapMatches(value: unknown) {
  return z.array(RpcRow).parse(value).map((row) => ({
    ...row, workplace_type: workplaceBadge(row.workplace_type), location_label: locationLabel(row.locations_json) ?? locationLabel(row.location_label), locations_json: undefined, canonical_posting_url: sourceUrl(row.canonical_posting_url), application_url: sourceUrl(row.application_url),
  }));
}
export type Match = ReturnType<typeof mapMatches>[number];
