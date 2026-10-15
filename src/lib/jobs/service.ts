import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import { ApiErrorSchema, FeedRequest, PreferencesRequest, type ApiError } from "../../../specs/api/contracts";
import { mapMatches, mergeQueryWithChips, preferenceColumns, PreferencesInput, type MatchingChips } from "./model";
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
  const result = await client.from("job_preferences").update(values).eq("candidate_profile_id", values.candidate_profile_id).eq("user_id", userId).select(preferenceColumns).single();
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
  await ensurePreferences(client, userId, values.candidate_profile_id);
  const chips = await approvedResumeChips(client, userId, values.candidate_profile_id);
  const result = await client.rpc("match_jobs_hybrid", {
    p_candidate_profile_id: values.candidate_profile_id, p_query_text: mergeQueryWithChips(values.query, chips),
    p_include_stretch_exceptions: values.include_stretch_exceptions, p_rrf_k: 60, p_top_n: values.limit,
  });
  dbError(result.error);
  return mapMatches(result.data, chips);
}
