import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import { ApiErrorSchema, FeedRequest, PreferencesRequest, type ApiError } from "../../../specs/api/contracts";
import { mapMatches, mergeQueryWithChips, monotonicScores, preferenceColumns, PreferencesInput, sortMatches, titleMatches, zipToPoint, type MatchingChips } from "./model";
import { aiBinding, ensureProfileEmbedding } from "./profile-embedding";
type Client = Awaited<ReturnType<typeof createClient>>;
export class JobError extends Error {
  constructor(public code: ApiError["code"], message: string, public status: number) { super(message); }
}
export function dbError(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === "42501") throw new JobError("FORBIDDEN", "You do not have access to this profile.", 403);
  if (error.code === "23505") throw new JobError("CONFLICT", "The profile changed. Reload and try again.", 409);
  throw new JobError("SOURCE_UNAVAILABLE", "The data service is unavailable. Please try again.", 503);
}
export function errorResponse(error: unknown) {
  const failure = error instanceof JobError ? error : error instanceof z.ZodError
    ? new JobError("INVALID_INPUT", "Invalid request or data. Check the form fields and try again.", 400)
    : new JobError("SOURCE_UNAVAILABLE", "The service is unavailable. Please try again.", 503);
  return Response.json(ApiErrorSchema.parse({ code: failure.code, message: failure.message, request_id: crypto.randomUUID() }), { status: failure.status, headers: { "Cache-Control": "private, no-store" } });
}
export async function authenticated(client: Client) {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new JobError("UNAUTHENTICATED", "Sign in to continue.", 401);
  return user;
}
const Profile = z.object({ id: z.string().uuid() });
export async function ensurePreferences(client: Client, userId: string, profileId?: string) {
  let query = client.from("candidate_profiles").select("id").eq("user_id", userId);
  query = profileId ? query.eq("id", profileId) : query.order("is_default", { ascending: false }).order("created_at").limit(1);
  let { data, error } = await query.maybeSingle();
  dbError(error);
  if (!data && profileId) throw new JobError("FORBIDDEN", "Profile not found or not owned by you.", 403);
  if (!data) {
    const inserted = await client.from("candidate_profiles").upsert({ user_id: userId, profile_name: "default", is_default: true }, { onConflict: "user_id,profile_name", ignoreDuplicates: true });
    dbError(inserted.error);
    const found = await client.from("candidate_profiles").select("id").eq("user_id", userId).eq("profile_name", "default").single();
    data = found.data; error = found.error; dbError(error);
  }
  const profile = Profile.parse(data);
  const result = await client.from("job_preferences").upsert({ user_id: userId, candidate_profile_id: profile.id }, { onConflict: "candidate_profile_id", ignoreDuplicates: true });
  dbError(result.error);
  const preferences = await client.from("job_preferences").select(preferenceColumns).eq("candidate_profile_id", profile.id).eq("user_id", userId).single();
  dbError(preferences.error);
  return PreferencesRequest.parse(preferences.data);
}
export async function savePreferences(client: Client, userId: string, input: unknown) {
  const values = PreferencesInput.parse(input);
  await ensurePreferences(client, userId, values.candidate_profile_id);
  let home_geo_point: string | null = null;
  if (values.home_zip) {
    const point = zipToPoint(values.home_zip);
    if (!point) throw new JobError("INVALID_INPUT", "That ZIP code is not in the offline lookup. Check it, or leave it blank.", 400);
    home_geo_point = `SRID=4326;POINT(${point[1]} ${point[0]})`;
  }
  const result = await client.from("job_preferences").update("home_zip" in values ? { ...values, home_geo_point } : values).eq("candidate_profile_id", values.candidate_profile_id).eq("user_id", userId).select(preferenceColumns).single();
  dbError(result.error);
  return PreferencesRequest.parse(result.data);
}
const ApprovedChips = z.object({ normalized_profile_json: z.object({ chips: z.object({ titles: z.array(z.string()).max(20), skills: z.array(z.string()).max(100) }).passthrough() }).passthrough() });
/**
 * Confirmed chips from the newest resume on this profile, only when its latest version has
 * "Use for matching" on (resume_versions.is_user_approved). Session client + explicit user_id: RLS-scoped.
 */
export async function approvedResumeChips(client: Client, userId: string, profileId: string): Promise<MatchingChips | null> {
  const resume = await client.from("resumes").select("id").eq("user_id", userId).eq("candidate_profile_id", profileId).eq("parse_status", "completed").order("created_at", { ascending: false }).order("id").limit(1).maybeSingle();
  dbError(resume.error);
  const resumeId = (resume.data as { id?: unknown } | null)?.id;
  if (typeof resumeId !== "string") return null;
  const version = await client.from("resume_versions").select("is_user_approved,normalized_profile_json").eq("user_id", userId).eq("base_resume_id", resumeId).order("created_at", { ascending: false }).order("id").limit(1).maybeSingle();
  dbError(version.error);
  const row = version.data as { is_user_approved?: unknown } | null;
  if (!row || row.is_user_approved !== true) return null;
  const parsed = ApprovedChips.safeParse(row);
  if (!parsed.success) return null;
  const { titles, skills } = parsed.data.normalized_profile_json.chips;
  return titles.length || skills.length ? { titles, skills } : null;
}
export async function findMatches(client: Client, userId: string, input: unknown) {
  const values = FeedRequest.parse(input);
  const prefs = await ensurePreferences(client, userId, values.candidate_profile_id);
  const chips = await approvedResumeChips(client, userId, values.candidate_profile_id);
  const region = values.region ?? "all";
  // Semantic leg: keep the profile embedding in step with the confirmed chips (Workers AI; no-op elsewhere).
  await ensureProfileEmbedding(client, userId, values.candidate_profile_id, chips, await aiBinding());
  // Region and US/Remote now filter in SQL before the top-N cut (0009); only the title filter runs here.
  const filtering = Boolean(values.title_keywords?.length);
  const sorting = (values.sort ?? "best") !== "best";
  const result = await client.rpc("match_jobs_hybrid", {
    p_candidate_profile_id: values.candidate_profile_id, p_query_text: mergeQueryWithChips(values.query, chips),
    // Over-fetch the RPC maximum when filtering/sorting so the requested page is drawn from the best 50.
    p_include_stretch_exceptions: values.include_stretch_exceptions, p_rrf_k: 60, p_top_n: filtering || sorting ? 50 : values.limit,
    p_region: region, p_us_or_remote_only: values.us_or_remote_only === true, p_max_per_employer: 3,
  });
  dbError(result.error);
  // Filters run after chip widening, so resume chips can never override the title filter.
  let rows = z.array(z.object({ canonical_job_id: z.string(), title: z.string(), workplace_type: z.string().nullish(), locations_json: z.unknown().optional(), location_label: z.string().nullish() }).passthrough()).parse(result.data)
    .filter((row) => titleMatches(row.title, values.title_keywords));
  // Card metadata (posted date, coordinates) from 0008; degrade gracefully if it is not applied yet.
  if (rows.length) {
    const meta = await client.rpc("job_card_meta", { p_job_ids: rows.map((r) => r.canonical_job_id) });
    if (!meta.error && Array.isArray(meta.data)) {
      const byId = new Map((meta.data as Array<Record<string, unknown>>).map((m) => [m.canonical_job_id, m]));
      rows = rows.map((r) => { const m = byId.get(r.canonical_job_id); return m ? { ...r, original_published_at: m.original_published_at ?? null, first_discovered_at: m.first_discovered_at ?? null, latitude: m.latitude ?? null, longitude: m.longitude ?? null } : r; });
    }
  }
  const originZip = values.sort_zip ?? prefs.home_zip ?? null; const originPoint = originZip ? zipToPoint(originZip) : null;
  const mapped = mapMatches(rows, chips, {
    query: values.query, title_keywords: values.title_keywords, salary_floor: prefs.hard_min_annual_salary_usd,
    allowed_workplaces: prefs.allowed_workplace_types, origin: originZip && originPoint ? { zip: originZip, point: originPoint } : null,
  });
  const sort = values.sort ?? "best";
  const page = sortMatches(mapped, sort, values.workplace_order).slice(0, values.limit);
  // Best match: the displayed 1-10 score never increases down the list.
  return sort === "best" ? monotonicScores(page) : page;
}
