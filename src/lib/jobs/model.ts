import { z } from "zod";
import { locationLabel, locationTextParts, workplaceBadge } from "./workplace-badge";
import { PreferencesRequest } from "../../../specs/api/contracts";
import { ZIP3_CENTROIDS } from "../geo/zip3-centroids";

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
  // Optional card metadata from job_card_meta (0008); absent when that RPC is unavailable.
  original_published_at: z.string().nullish(), first_discovered_at: z.string().nullish(),
  latitude: z.number().nullish(), longitude: z.number().nullish(),
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

export interface MatchContext {
  query?: string; title_keywords?: string[]; salary_floor?: number | null; allowed_workplaces?: string[];
  origin?: { zip: string; point: [number, number] } | null; now?: number;
}
function zipPoint(text: string): [number, number] | null {
  const m = /\b(\d{5})(?:-\d{4})?\b/.exec(text); return m ? (ZIP3_CENTROIDS[m[1]!.slice(0, 3)] ?? null) : null;
}
export function zipToPoint(zip: string): [number, number] | null {
  return /^\d{5}$/.test(zip) ? (ZIP3_CENTROIDS[zip.slice(0, 3)] ?? null) : null;
}
export function mapMatches(value: unknown, chips?: MatchingChips | null, ctx: MatchContext = {}) {
  const rows = z.array(RpcRow).parse(value);
  const rrfs = rows.map((r) => r.rrf_score); const minRrf = Math.min(...rrfs), maxRrf = Math.max(...rrfs);
  return rows.map((row) => {
    const region = jobRegion(row);
    const posted_days_ago = daysSince(row.original_published_at ?? row.first_discovered_at, ctx.now);
    const jobPoint: [number, number] | null = row.latitude != null && row.longitude != null ? [row.latitude, row.longitude] : zipPoint([...locationTextParts(row.locations_json), row.location_label ?? ""].join(" "));
    const distance_miles = ctx.origin && jobPoint ? Math.round(haversineMiles(ctx.origin.point, jobPoint)) : null;
    const fit = explainFit(row, ctx.query ?? "");
    const titleHit = fit.keyword === "strong" || Boolean(ctx.title_keywords?.length && titleMatches(row.title, ctx.title_keywords));
    const salary = row.max_annual_salary_usd ?? row.min_annual_salary_usd;
    const salaryOk = salary !== null && (ctx.salary_floor == null || salary >= ctx.salary_floor);
    const workplaceOk = Boolean(row.workplace_type && ctx.allowed_workplaces?.includes(row.workplace_type.toLowerCase()));
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
      region, company_origin: companyOrigin(region).label,
      posted_days_ago, posted_label: postedLabel(posted_days_ago),
      distance_miles,
      distance_label: !ctx.origin ? null : distance_miles !== null ? `${distance_miles} mi from ${ctx.origin.zip}` : "Distance unknown",
      match_score: matchScore({ rrf: row.rrf_score, minRrf, maxRrf, titleHit, salaryOk, workplaceOk }),
      fit,
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
/**
 * A typed multi-word role query ("account executive") is treated as a phrase so websearch_to_tsquery
 * yields 'account' <-> 'execut' instead of 'account' & 'execut' anywhere in the description.
 * Queries that already use websearch syntax (quotes, or, leading -) are passed through unchanged.
 */
export function phraseQuery(query: string): string {
  const base = query.replace(/\s+/g, " ").trim();
  if (!base || base.includes('"') || /(^|\s)-\S/.test(base) || /\s(or|and)\s/i.test(` ${base} `)) return base;
  const words = base.split(" ");
  return words.length > 1 ? `"${base.replace(/[()\\:&|!<>*]/g, " ").replace(/\s+/g, " ").trim()}"` : base;
}
export function mergeQueryWithChips(query: string, chips: MatchingChips | null | undefined): string {
  const base = phraseQuery(query);
  if (!chips) return base;
  const seen = new Set<string>(); const terms: string[] = [];
  for (const value of [...chips.titles.slice(0, MAX_TITLES), ...chips.skills.slice(0, MAX_SKILLS)]) {
    const quoted = term(value); if (!quoted || seen.has(quoted.toLowerCase())) continue;
    seen.add(quoted.toLowerCase()); terms.push(quoted);
  }
  if (!terms.length) return base;
  return [base, ...terms].filter(Boolean).join(" or ");
}

const titleNorm = (value: string) => ` ${value.toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, " ").trim()} `;
/** Title-only keyword filter: a job passes if its title contains ANY keyword as a whole word/phrase. */
export function titleMatches(title: string, keywords: readonly string[] | undefined): boolean {
  const wanted = (keywords ?? []).map(titleNorm).filter((k) => k.trim());
  if (!wanted.length) return true;
  const value = titleNorm(title);
  return wanted.some((k) => value.includes(k));
}
const US_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
const US_STATE_NAMES = "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming";
const US_CI_RE = new RegExp(`\\b(?:united states|usa|u\\.s\\.(?:a\\.)?|${US_STATE_NAMES})(?![a-z])`, "i");
// Case-sensitive for 2-letter codes (", TX", "US") to avoid matching "us"/"or" in prose.
const US_CS_RE = new RegExp(`\\bUS\\b|,\\s*(?:${US_STATES})\\b|^(?:${US_STATES})$`);
const NON_US_RE = /\b(?:canada|united kingdom|uk|great britain|england|scotland|wales|ireland|germany|deutschland|france|spain|portugal|italy|netherlands|belgium|switzerland|austria|sweden|norway|denmark|finland|iceland|poland|czech(?:ia| republic)?|romania|hungary|greece|turkey|israel|uae|united arab emirates|saudi arabia|egypt|nigeria|kenya|ghana|south africa|india|pakistan|bangladesh|singapore|malaysia|indonesia|philippines|vietnam|thailand|japan|korea|china|hong kong|taiwan|australia|new zealand|brazil|argentina|chile|colombia|peru|mexico|costa rica|emea|apac|latam|europe|asia|toronto|vancouver|montreal|london|berlin|munich|dublin|paris|amsterdam|stockholm|madrid|barcelona|lisbon|warsaw|zurich|tel aviv|bangalore|bengaluru|sydney|melbourne|tokyo|seoul|são paulo|sao paulo)\b/i;
const isUsText = (text: string) => US_CI_RE.test(text) || US_CS_RE.test(text);
export type JobRegion = "us" | "non_us" | "unknown";
/** Region from stored location text only. Remote roles count by stated region ("Remote - US" = US, "Remote - Sweden" = Non-US). */
export function jobRegion(row: { locations_json?: unknown; location_label?: string | null }): JobRegion {
  const parts = [...locationTextParts(row.locations_json), ...(row.location_label ? [row.location_label] : [])];
  if (parts.some(isUsText)) return "us";
  if (parts.some((p) => NON_US_RE.test(p))) return "non_us";
  return "unknown";
}
/** "US or Remote only": US-located roles, plus Remote roles that do not state a non-US region. */
export function usOrRemote(row: { workplace_type?: string | null; locations_json?: unknown; location_label?: string | null }): boolean {
  const region = jobRegion(row);
  return region === "us" || ((row.workplace_type ?? "").toLowerCase() === "remote" && region === "unknown");
}
/** No employer HQ/country is stored, so origin is a labelled fallback from the posting's location. */
export function companyOrigin(region: JobRegion): { label: "US posting" | "Non-US posting" | "Origin unknown"; inferred: true } {
  return { label: region === "us" ? "US posting" : region === "non_us" ? "Non-US posting" : "Origin unknown", inferred: true };
}
export function haversineMiles(a: [number, number], b: [number, number]): number {
  const r = (d: number) => (d * Math.PI) / 180; const R = 3958.8;
  const dLat = r(b[0] - a[0]), dLng = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null; const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
}
export const postedLabel = (days: number | null) => days === null ? null : days === 0 ? "Posted today" : days === 1 ? "Posted 1 day ago" : `Posted ${days} days ago`;

export type FitLevel = "strong" | "moderate" | "weak" | "none";
/** Plain-language fit. Keyword fit is "strong" only when the search words are in the title. */
export function explainFit(row: { title: string; lexical_rank: number; semantic_similarity: number }, query: string) {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? []).filter((w) => w.length > 1 && !["or", "and", "not"].includes(w));
  const inTitle = words.length > 0 && titleMatches(row.title, [words.join(" ")]);
  const keyword: FitLevel = inTitle ? "strong" : row.lexical_rank > 0 ? "moderate" : "none";
  const semantic: FitLevel = row.semantic_similarity >= 0.5 ? "strong" : row.semantic_similarity >= 0.3 ? "moderate" : row.semantic_similarity > 0 ? "weak" : "none";
  return {
    keyword, semantic,
    keyword_text: keyword === "strong" ? "Keyword fit: strong, your search words appear in the title" : keyword === "moderate" ? "Keyword fit: moderate, your search words appear in the posting but not as the title" : words.length ? "Keyword fit: none, your search words were not found" : "Keyword fit: no search words entered",
    semantic_text: semantic === "strong" ? "Meaning fit: strong, very similar responsibilities to your profile" : semantic === "moderate" ? "Meaning fit: moderate, similar responsibilities to your profile" : semantic === "weak" ? "Meaning fit: weak, only loosely related to your profile" : "Meaning fit: not available (no profile or job embedding yet)",
    overall_text: "Overall rank: combines keyword and meaning fit (reciprocal rank fusion)",
  };
}
/**
 * Match score 1-10, deterministic and relative to this result set:
 *   base   = 1 + 6 × (rrf − min rrf) / (max rrf − min rrf)   (7 when all rrf are equal)
 *   +1.5   if the title satisfies the search phrase or a "title must include" keyword
 *   +1     if the known max (or min) salary meets your salary floor
 *   +0.5   if the workplace mode is one you allow
 * rounded and clamped to 1..10.
 */
export function matchScore(input: { rrf: number; minRrf: number; maxRrf: number; titleHit: boolean; salaryOk: boolean; workplaceOk: boolean }): number {
  const span = input.maxRrf - input.minRrf;
  const base = span > 0 ? 1 + 6 * ((input.rrf - input.minRrf) / span) : 7;
  const score = base + (input.titleHit ? 1.5 : 0) + (input.salaryOk ? 1 : 0) + (input.workplaceOk ? 0.5 : 0);
  return Math.max(1, Math.min(10, Math.round(score)));
}
export type SortKey = "best" | "workplace" | "distance" | "compensation" | "newest";
export type WorkplaceMode = "Remote" | "Hybrid" | "Onsite";
export function sortMatches<T extends { rrf_score: number; workplace_type: string; distance_miles: number | null; min_annual_salary_usd: number | null; max_annual_salary_usd: number | null; posted_days_ago: number | null }>(rows: T[], sort: SortKey, workplaceOrder: WorkplaceMode[] = ["Remote", "Hybrid", "Onsite"]): T[] {
  const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) => a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : dir * (a - b);
  const indexed = rows.map((row, i) => ({ row, i }));
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    best: () => 0,
    workplace: (a, b) => { const r = (w: string) => { const k = workplaceOrder.indexOf(w as WorkplaceMode); return k < 0 ? 99 : k; }; return r(a.workplace_type) - r(b.workplace_type); },
    distance: (a, b) => nullsLast(a.distance_miles, b.distance_miles, 1),
    compensation: (a, b) => nullsLast(a.max_annual_salary_usd ?? a.min_annual_salary_usd, b.max_annual_salary_usd ?? b.min_annual_salary_usd, -1) || nullsLast(a.min_annual_salary_usd, b.min_annual_salary_usd, -1),
    newest: (a, b) => nullsLast(a.posted_days_ago, b.posted_days_ago, 1),
  };
  // Stable: ties keep the server's best-match order.
  return indexed.sort((x, y) => cmp[sort](x.row, y.row) || x.i - y.i).map((x) => x.row);
}
