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
  workplace_type: z.string().nullish(), workplace_inferred: z.boolean().optional(),
  locations_json: z.unknown().optional(), location_label: z.string().nullish(), employment_type: z.string(),
  description_plain: z.string().nullish(),
  extracted_required_skills: z.array(z.string()).nullish(), extracted_preferred_skills: z.array(z.string()).nullish(),
  min_annual_salary_usd: z.number().nullable(), max_annual_salary_usd: z.number().nullable(),
  is_salary_estimated: z.boolean(), canonical_posting_url: z.string().nullable(), application_url: z.string().nullable(),
  semantic_similarity: z.number(), lexical_rank: z.number(), rrf_score: z.number(),
  match_reason: z.string().nullish(),
});
type RpcRowValue = z.infer<typeof RpcRow>;
/** Confirmed resume chips used to steer matching (session-scoped; only when "Use for matching" is on). */
export type MatchingChips = { titles: string[]; skills: string[] };

export function sourceUrl(value: string | null): string | null {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
function words(value: string) { return new Set(norm(value).match(/[\p{L}\p{N}+#.]+/gu) ?? []); }

/** Short, honest overlap line derived from stored job fields vs confirmed resume chips. */
export function matchReason(row: Pick<RpcRowValue, "title" | "extracted_required_skills" | "extracted_preferred_skills">, chips: MatchingChips | null | undefined): string | null {
  if (!chips || (!chips.titles.length && !chips.skills.length)) return null;
  const title = norm(row.title); const titleWords = words(row.title);
  const titles = chips.titles.filter((candidate) => {
    const value = norm(candidate);
    if (!value) return false;
    if (title.includes(value) || value.includes(title)) return true;
    const tokens = [...words(candidate)].filter((token) => token.length > 2);
    return tokens.length > 0 && tokens.filter((token) => titleWords.has(token)).length >= Math.min(2, tokens.length);
  });
  const jobSkills = new Set([...(row.extracted_required_skills ?? []), ...(row.extracted_preferred_skills ?? [])].map(norm));
  const skills = chips.skills.filter((skill) => jobSkills.has(norm(skill)) || (norm(skill).length > 2 && titleWords.has(norm(skill))));
  const parts: string[] = [];
  if (titles.length) parts.push(`Matches your titles: ${titles.slice(0, 2).join(", ")}`);
  if (skills.length) parts.push(`Skills: ${skills.slice(0, 4).join(", ")}`);
  return parts.length ? parts.join(" · ") : null;
}

export function mapMatches(value: unknown, chips?: MatchingChips | null) {
  return z.array(RpcRow).parse(value).map((row) => {
    const badge = workplaceBadge(row.workplace_type, { title: row.title, locations_json: row.locations_json, description: row.description_plain });
    return {
      canonical_job_id: row.canonical_job_id, title: row.title, employer_name: row.employer_name,
      workplace_type: badge.label,
      // Inference is display-only; preserve the flag across the API → client round trip.
      workplace_inferred: badge.inferred || (row.workplace_inferred === true && badge.label !== "Unknown"),
      location_label: locationLabel(row.locations_json) ?? locationLabel(row.location_label),
      employment_type: row.employment_type,
      min_annual_salary_usd: row.min_annual_salary_usd, max_annual_salary_usd: row.max_annual_salary_usd, is_salary_estimated: row.is_salary_estimated,
      canonical_posting_url: sourceUrl(row.canonical_posting_url), application_url: sourceUrl(row.application_url),
      semantic_similarity: row.semantic_similarity, lexical_rank: row.lexical_rank, rrf_score: row.rrf_score,
      match_reason: chips !== undefined ? matchReason(row, chips) : (row.match_reason ?? null),
    };
  });
}
export type Match = ReturnType<typeof mapMatches>[number];

const MAX_TITLES = 8; const MAX_SKILLS = 20;
function term(value: string) {
  // Quote each chip as a websearch phrase; strip syntax characters so chips cannot alter query operators.
  const cleaned = value.replace(/["'()\\:&|!<>*-]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned && !/^(or|and|not)$/i.test(cleaned) ? `"${cleaned}"` : null;
}
/**
 * Merge confirmed resume chips into the lexical query passed to match_jobs_hybrid.
 * Chips are OR-ed (websearch_to_tsquery `or`) so they widen recall instead of AND-narrowing it;
 * the user's typed query stays as-is. Ranking math in SQL is unchanged.
 */
export function mergeQueryWithChips(query: string, chips: MatchingChips | null | undefined): string {
  const base = query.trim();
  if (!chips) return base;
  const seen = new Set<string>(); const terms: string[] = [];
  for (const value of [...chips.titles.slice(0, MAX_TITLES), ...chips.skills.slice(0, MAX_SKILLS)]) {
    const quoted = term(value); if (!quoted || seen.has(quoted.toLowerCase())) continue;
    seen.add(quoted.toLowerCase()); terms.push(quoted);
  }
  if (!terms.length) return base;
  return [base, ...terms].filter(Boolean).join(" or ");
}
