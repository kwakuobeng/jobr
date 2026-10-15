import { z } from "zod";
import { toMonthIndex } from "../../src/lib/resume/experience-calculator";
const uuid = z.string().uuid();
const date = z.string().refine((value) => {
  try {
    toMonthIndex(value);
    return true;
  } catch {
    return false;
  }
}, "Invalid calendar date");
export const ApiErrorSchema = z
  .object({
    code: z.enum([
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "INVALID_INPUT",
      "CONFLICT",
      "RATE_LIMITED",
      "SOURCE_UNAVAILABLE",
      "UNVERIFIED_EVIDENCE",
    ]),
    message: z.string(),
    request_id: uuid,
  })
  .strict();
export const ResumeUploadRequest = z
  .object({
    filename: z.string().min(1).max(255),
    mime_type: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    size_bytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .strict();
export const ResumeUploadResponse = z
  .object({
    resume_id: uuid,
    upload_url: z.string().url(),
    expires_at: z.string().datetime(),
  })
  .strict();
export const ResumeParseRequest = z.object({ resume_id: uuid }).strict();
export const ExperienceEditRequest = z
  .object({
    candidate_profile_id: uuid,
    intervals: z.array(
      z
        .object({
          id: uuid,
          start_date: date,
          end_date: date.nullable(),
          is_current: z.boolean(),
          is_internship: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export const PreferencesRequest = z
  .object({
    candidate_profile_id: uuid,
    excluded_employer_ids: z.array(uuid),
    excluded_tech_slugs: z.array(z.string().min(1)),
    allowed_workplace_types: z
      .array(z.enum(["remote", "hybrid", "onsite"]))
      .min(1),
    allowed_employment_types: z
      .array(
        z.enum([
          "full_time",
          "part_time",
          "contract",
          "internship",
          "temporary",
        ]),
      )
      .min(1),
    hard_min_annual_salary_usd: z.number().int().nonnegative().nullable(),
    allow_undisclosed_salary: z.boolean(),
    requires_visa_sponsorship: z.boolean(),
    max_commute_miles: z.number().nonnegative().nullable(),
    // US ZIP for the commute radius (0008). Radius applies only to hybrid/onsite roles; remote is exempt.
    home_zip: z.string().regex(/^\d{5}$/).nullable().optional(),
  })
  .strict();
export const FeedRequest = z
  .object({
    candidate_profile_id: uuid,
    query: z.string().max(1000),
    include_stretch_exceptions: z.boolean(),
    limit: z.number().int().min(1).max(50),
    // Session-scoped refinements (not persisted): title-only keyword filter and a US/Remote location filter.
    title_keywords: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
    us_or_remote_only: z.boolean().optional(),
    region: z.enum(["all", "us", "non_us", "unknown"]).optional(),
    sort: z.enum(["best", "workplace", "distance", "compensation", "newest"]).optional(),
    workplace_order: z.array(z.enum(["Remote", "Hybrid", "Onsite"])).max(3).optional(),
    sort_zip: z.string().regex(/^\d{5}$/).optional(),
  })
  .strict();
export const ExclusionTestResponse = z
  .object({ eligible: z.boolean(), failed_constraints: z.array(z.string()) })
  .strict();
export const RecommendationDecisionRequest = z
  .object({
    canonical_job_id: uuid,
    decision: z.enum([
      "reject",
      "save",
      "approve_for_preparation",
      "view",
      "reevaluate",
    ]),
    feedback: z.string().max(2000).nullable(),
    expected_version: z.number().int().nonnegative(),
  })
  .strict();
export const ApplicationPrepareRequest = z
  .object({ canonical_job_id: uuid, resume_version_id: uuid })
  .strict();
export const ApplicationAuthorizeRequest = z
  .object({
    application_id: uuid,
    prepared_artifact_hash: z.string().regex(/^[a-f0-9]{64}$/),
    verified_question_ids: z.array(z.string()),
    employer_consent_confirmed: z.literal(true),
    factual_answers_confirmed: z.literal(true),
    expected_version: z.number().int().nonnegative(),
  })
  .strict();
export const ApplicationReceiptRequest = z
  .object({
    application_id: uuid,
    authorization_id: uuid,
    receipt_storage_path: z.string().min(1),
    receipt_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const ApplicationStatus = z.enum([
  "discovered",
  "recommended",
  "saved",
  "approved_for_preparation",
  "ready_for_review",
  "authorized_for_submission",
  "submitted",
  "employer_acknowledged",
  "recruiter_screen",
  "interviewing",
  "assessment",
  "offer",
  "rejected",
  "withdrawn",
]);
export type ApiError = z.infer<typeof ApiErrorSchema>;
// Contract only: handlers authenticate from the session, derive user_id server-side,
// enforce RLS and optimistic versions, validate active jobs, and bind signatures to
// exact artifact hashes. A request body is never authority to record submission.
