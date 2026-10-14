-- Jobr Milestone M1.1: Core Multi-Tenant DDL, Indexes & Row-Level Security
-- Target: PostgreSQL 16 / Supabase
  
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "postgis";
  
CREATE TYPE user_role_type AS ENUM ('candidate', 'admin', 'support_auditor');
CREATE TYPE skill_evidence_type AS ENUM ('explicit_resume', 'user_verified_addition', 'inferred_transferable');
CREATE TYPE workplace_mode_type AS ENUM ('remote', 'hybrid', 'onsite', 'unspecified');
CREATE TYPE employment_commitment_type AS ENUM ('full_time', 'part_time', 'contract', 'internship', 'temporary');
CREATE TYPE seniority_level_type AS ENUM ('intern', 'entry', 'mid', 'senior', 'staff_principal', 'manager', 'director_vp', 'executive');
CREATE TYPE recommendation_tier_type AS ENUM ('strong_match', 'worth_considering', 'stretch_opportunity', 'poor_fit');
CREATE TYPE application_lifecycle_status AS ENUM (
  'discovered',
  'recommended',
  'saved',
  'approved_for_preparation',
  'ready_for_review',
  'authorized_for_submission',
  'submitted',
  'employer_acknowledged',
  'recruiter_screen',
  'interviewing',
  'assessment',
  'offer',
  'rejected',
  'withdrawn'
);
  
CREATE TABLE public.users_profile (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role user_role_type NOT NULL DEFAULT 'candidate',
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  onboarding_completed_at TIMESTAMPTZ,
  account_deletion_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.candidate_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL DEFAULT 'Primary Career Profile',
  is_default BOOLEAN NOT NULL DEFAULT true,
  headline TEXT,
  summary_text TEXT,
  total_experience_months INTEGER NOT NULL DEFAULT 0 CHECK (total_experience_months >= 0),
  inferred_seniority seniority_level_type,
  primary_industry_slugs TEXT[] NOT NULL DEFAULT '{}',
  career_trajectory_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_job_embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, profile_name)
);
  
CREATE TABLE public.resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  candidate_profile_id UUID NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  storage_bucket_path TEXT NOT NULL UNIQUE,
  file_sha256 TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  raw_extracted_text TEXT NOT NULL,
  structured_line_map JSONB NOT NULL DEFAULT '[]'::jsonb,
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.resume_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  base_resume_id UUID NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
  target_canonical_job_id UUID,
  version_label TEXT NOT NULL,
  normalized_profile_json JSONB NOT NULL,
  generated_storage_path TEXT,
  is_user_approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.extracted_experiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  candidate_profile_id UUID NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  employer_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  is_current BOOLEAN NOT NULL DEFAULT false,
  is_internship BOOLEAN NOT NULL DEFAULT false,
  non_overlapping_months_contributed INTEGER NOT NULL DEFAULT 0,
  bullets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.extracted_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  candidate_profile_id UUID NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  skill_slug TEXT NOT NULL,
  skill_display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hard_skill', 'tool_tech', 'certification', 'domain', 'soft_skill')),
  evidence_type skill_evidence_type NOT NULL,
  verbatim_quote TEXT,
  source_line_ids TEXT[] NOT NULL DEFAULT '{}',
  calculated_experience_months INTEGER NOT NULL DEFAULT 0,
  user_confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_profile_id, skill_slug)
);
  
CREATE TABLE public.job_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  candidate_profile_id UUID NOT NULL UNIQUE REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  desired_titles TEXT[] NOT NULL DEFAULT '{}',
  adjacent_titles TEXT[] NOT NULL DEFAULT '{}',
  target_industries TEXT[] NOT NULL DEFAULT '{}',
  preferred_employer_ids UUID[] NOT NULL DEFAULT '{}',
  excluded_employer_ids UUID[] NOT NULL DEFAULT '{}',
  excluded_employer_domains TEXT[] NOT NULL DEFAULT '{}',
  allowed_workplace_types workplace_mode_type[] NOT NULL DEFAULT '{remote,hybrid,onsite}',
  preferred_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
  home_geo_point geography(Point, 4326),
  max_commute_miles INTEGER CHECK (max_commute_miles >= 0 AND max_commute_miles <= 500),
  willing_to_relocate BOOLEAN NOT NULL DEFAULT false,
  hard_min_annual_salary_usd INTEGER CHECK (hard_min_annual_salary_usd >= 0),
  target_annual_salary_usd INTEGER CHECK (target_annual_salary_usd >= 0),
  allow_undisclosed_salary BOOLEAN NOT NULL DEFAULT true,
  allowed_employment_types employment_commitment_type[] NOT NULL DEFAULT '{full_time}',
  target_seniority_levels seniority_level_type[] NOT NULL DEFAULT '{senior}',
  required_tech_slugs TEXT[] NOT NULL DEFAULT '{}',
  excluded_tech_slugs TEXT[] NOT NULL DEFAULT '{}',
  requires_visa_sponsorship BOOLEAN NOT NULL DEFAULT false,
  security_clearance_status TEXT NOT NULL DEFAULT 'none',
  custom_scoring_weights JSONB NOT NULL DEFAULT '{"skill":0.28,"semantic":0.20,"experience":0.15,"seniority":0.12,"compensation":0.10,"location":0.08,"trajectory":0.07}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  candidate_profile_id UUID NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  search_name TEXT NOT NULL,
  filter_criteria_json JSONB NOT NULL,
  alert_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.job_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type TEXT NOT NULL CHECK (provider_type IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'usajobs', 'jobspipe', 'jsearch', 'user_url')),
  tenant_slug TEXT,
  display_name TEXT NOT NULL,
  base_endpoint_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  poll_interval_minutes INTEGER NOT NULL DEFAULT 240,
  last_synced_at TIMESTAMPTZ,
  last_sync_watermark JSONB,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_breaker_open_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_type, tenant_slug)
);
  
CREATE TABLE public.canonical_employers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  normalized_slug TEXT NOT NULL UNIQUE,
  primary_domain TEXT UNIQUE,
  industry_slugs TEXT[] NOT NULL DEFAULT '{}',
  greenhouse_board_token TEXT,
  lever_site_slug TEXT,
  ashby_board_name TEXT,
  smartrecruiters_company_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.canonical_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_employer_id UUID NOT NULL REFERENCES public.canonical_employers(id) ON DELETE RESTRICT,
  identity_hash TEXT NOT NULL UNIQUE,
  description_simhash BIGINT NOT NULL,
  title TEXT NOT NULL,
  normalized_title_slug TEXT NOT NULL,
  employer_name TEXT NOT NULL,
  locations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_geo_point geography(Point, 4326),
  workplace_type workplace_mode_type NOT NULL DEFAULT 'unspecified',
  employment_type employment_commitment_type NOT NULL DEFAULT 'full_time',
  seniority_level seniority_level_type,
  min_annual_salary_usd INTEGER,
  max_annual_salary_usd INTEGER,
  salary_currency TEXT DEFAULT 'USD',
  is_salary_estimated BOOLEAN NOT NULL DEFAULT false,
  description_plain TEXT NOT NULL,
  description_html_sanitized TEXT,
  requirements_summary_text TEXT,
  extracted_required_skills TEXT[] NOT NULL DEFAULT '{}',
  extracted_preferred_skills TEXT[] NOT NULL DEFAULT '{}',
  extracted_tech_slugs TEXT[] NOT NULL DEFAULT '{}',
  min_years_experience NUMERIC(4,1),
  max_years_experience NUMERIC(4,1),
  visa_sponsorship_policy TEXT NOT NULL DEFAULT 'unknown' CHECK (visa_sponsorship_policy IN ('offered', 'explicit_no', 'unknown')),
  canonical_posting_url TEXT NOT NULL,
  application_url TEXT NOT NULL,
  application_mode_supported TEXT NOT NULL DEFAULT 'mode_a' CHECK (application_mode_supported IN ('mode_a', 'mode_b', 'mode_c')),
  screening_questions_schema JSONB,
  compliance_metadata JSONB,
  original_published_at TIMESTAMPTZ,
  first_discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  repost_count INTEGER NOT NULL DEFAULT 0,
  ghost_risk_score NUMERIC(4,3) NOT NULL DEFAULT 0.000,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'expired', 'flagged_spam')),
  closed_at TIMESTAMPTZ,
  closed_reason TEXT,
  search_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(employer_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(requirements_summary_text, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description_plain, '')), 'C')
  ) STORED,
  requirements_embedding vector(1536)
);
  
CREATE TABLE public.job_discovery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_job_id UUID NOT NULL REFERENCES public.canonical_jobs(id) ON DELETE CASCADE,
  job_source_id UUID NOT NULL REFERENCES public.job_sources(id) ON DELETE CASCADE,
  external_job_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_polled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload_hash TEXT NOT NULL,
  UNIQUE (job_source_id, external_job_id)
);
  
CREATE TABLE public.match_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  candidate_profile_id UUID NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  canonical_job_id UUID NOT NULL REFERENCES public.canonical_jobs(id) ON DELETE CASCADE,
  identity_hash TEXT NOT NULL,
  passed_hard_filters BOOLEAN NOT NULL,
  hard_filter_failure_reasons TEXT[] NOT NULL DEFAULT '{}',
  overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  skill_score NUMERIC(4,3) NOT NULL,
  semantic_score NUMERIC(4,3) NOT NULL,
  experience_score NUMERIC(4,3) NOT NULL,
  seniority_score NUMERIC(4,3) NOT NULL,
  compensation_score NUMERIC(4,3) NOT NULL,
  location_score NUMERIC(4,3) NOT NULL,
  trajectory_score NUMERIC(4,3) NOT NULL,
  recommendation_tier recommendation_tier_type NOT NULL,
  scoring_algorithm_version TEXT NOT NULL DEFAULT 'v1.0-hybrid',
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_profile_id, canonical_job_id)
);
  
CREATE TABLE public.match_explanations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_evaluation_id UUID NOT NULL UNIQUE REFERENCES public.match_evaluations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  why_it_matches_json JSONB NOT NULL,
  potential_concerns_json JSONB NOT NULL,
  summary_rationale TEXT NOT NULL,
  model_used TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.recommendation_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  candidate_profile_id UUID NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  canonical_job_id UUID NOT NULL REFERENCES public.canonical_jobs(id) ON DELETE CASCADE,
  match_evaluation_id UUID NOT NULL REFERENCES public.match_evaluations(id) ON DELETE CASCADE,
  identity_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('pending', 'saved', 'rejected', 'approved_for_prep', 'requested_deep_analysis')),
  rejection_reason_code TEXT CHECK (rejection_reason_code IN ('salary_too_low', 'wrong_tech_stack', 'location_commute', 'company_unappealing', 'seniority_mismatch', 'already_applied', 'other')),
  rejection_notes TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_profile_id, canonical_job_id)
);
  
CREATE TABLE public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  candidate_profile_id UUID NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  canonical_job_id UUID NOT NULL REFERENCES public.canonical_jobs(id) ON DELETE RESTRICT,
  match_evaluation_id UUID REFERENCES public.match_evaluations(id) ON DELETE SET NULL,
  selected_resume_version_id UUID REFERENCES public.resume_versions(id) ON DELETE SET NULL,
  current_status application_lifecycle_status NOT NULL DEFAULT 'discovered',
  is_status_confirmed BOOLEAN NOT NULL DEFAULT true,
  execution_mode TEXT NOT NULL DEFAULT 'mode_a' CHECK (execution_mode IN ('mode_a', 'mode_b', 'mode_c')),
  tailored_cover_letter_text TEXT,
  screening_QA_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  prep_approved_at TIMESTAMPTZ,
  submission_authorized_at TIMESTAMPTZ,
  submission_authorization_signature TEXT,
  submitted_at TIMESTAMPTZ,
  submission_confirmation_receipt TEXT,
  submission_evidence_storage_path TEXT,
  compensation_target_note TEXT,
  notes_markdown TEXT,
  contacts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, canonical_job_id)
);
  
CREATE TABLE public.application_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('mode_a', 'mode_b', 'mode_c')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('initiated', 'awaiting_user_submit', 'succeeded_confirmed', 'failed_retryable', 'failed_terminal')),
  http_status_code INTEGER,
  error_code TEXT,
  error_detail TEXT,
  confirmation_evidence_json JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
  
CREATE TABLE public.application_activity_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  from_status application_lifecycle_status,
  to_status application_lifecycle_status NOT NULL,
  is_confirmed_event BOOLEAN NOT NULL DEFAULT true,
  evidence_source TEXT NOT NULL CHECK (evidence_source IN ('user_manual', 'extension_receipt', 'partner_api_receipt', 'verified_email_webhook', 'system_workflow')),
  evidence_reference_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  round_name TEXT NOT NULL,
  interview_type TEXT NOT NULL CHECK (interview_type IN ('recruiter_screen', 'technical', 'system_design', 'hiring_manager', 'onsite_loop', 'other')),
  scheduled_start_at TIMESTAMPTZ NOT NULL,
  scheduled_end_at TIMESTAMPTZ,
  meeting_url TEXT,
  interviewer_names TEXT[] NOT NULL DEFAULT '{}',
  prep_notes_markdown TEXT,
  outcome TEXT NOT NULL DEFAULT 'scheduled' CHECK (outcome IN ('scheduled', 'completed', 'passed', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.applications(id) ON DELETE CASCADE,
  reminder_title TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'completed', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('new_high_match', 'approval_pending', 'application_update', 'interview_upcoming', 'reminder_due', 'system_alert')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
CREATE TABLE public.email_digest_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  included_match_ids UUID[] NOT NULL DEFAULT '{}',
  included_application_ids UUID[] NOT NULL DEFAULT '{}',
  delivery_status TEXT NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  sent_at TIMESTAMPTZ,
  UNIQUE (user_id, digest_date)
);
  
CREATE TABLE public.background_job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inngest_run_id TEXT NOT NULL UNIQUE,
  workflow_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  user_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_stack TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
  
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  resource_table TEXT NOT NULL,
  resource_id UUID,
  ip_address INET,
  user_agent TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
-- Indexes
CREATE INDEX idx_canonical_jobs_active_hnsw ON public.canonical_jobs
  USING hnsw (requirements_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE status = 'active';
CREATE INDEX idx_canonical_jobs_search_tsv ON public.canonical_jobs USING gin (search_tsv) WHERE status = 'active';
CREATE INDEX idx_canonical_jobs_tech_slugs ON public.canonical_jobs USING gin (extracted_tech_slugs) WHERE status = 'active';
CREATE INDEX idx_canonical_jobs_active_filters ON public.canonical_jobs (status, workplace_type, max_annual_salary_usd, last_seen_at DESC);
CREATE INDEX idx_match_evaluations_user_feed ON public.match_evaluations (user_id, candidate_profile_id, passed_hard_filters, overall_score DESC);
CREATE INDEX idx_applications_user_status ON public.applications (user_id, current_status, last_activity_at DESC);
CREATE INDEX idx_recommendation_decisions_identity ON public.recommendation_decisions (user_id, identity_hash);
  
-- RLS & Grant Revocation
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'candidate_profiles', 'resumes', 'resume_versions',
    'extracted_experiences', 'extracted_skills', 'job_preferences',
    'saved_searches', 'match_evaluations', 'match_explanations',
    'recommendation_decisions', 'applications', 'application_attempts',
    'application_activity_history', 'interviews', 'reminders',
    'notifications', 'email_digest_history'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated;', t);
    EXECUTE format('CREATE POLICY "%I_select_own" ON public.%I FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);', t, t);
    EXECUTE format('CREATE POLICY "%I_insert_own" ON public.%I FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);', t, t);
    EXECUTE format('CREATE POLICY "%I_update_own" ON public.%I FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);', t, t);
    EXECUTE format('CREATE POLICY "%I_delete_own" ON public.%I FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);', t, t);
  END LOOP;
END $$;
  
ALTER TABLE public.users_profile ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users_profile FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users_profile TO authenticated;
CREATE POLICY "users_profile_select_own" ON public.users_profile FOR SELECT TO authenticated USING ((select auth.uid()) = id);
CREATE POLICY "users_profile_insert_own" ON public.users_profile FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = id);
CREATE POLICY "users_profile_update_own" ON public.users_profile FOR UPDATE TO authenticated USING ((select auth.uid()) = id) WITH CHECK ((select auth.uid()) = id);
CREATE POLICY "users_profile_delete_own" ON public.users_profile FOR DELETE TO authenticated USING ((select auth.uid()) = id);
  
ALTER TABLE public.canonical_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.canonical_jobs FROM anon, authenticated;
GRANT SELECT ON TABLE public.canonical_jobs TO authenticated;
CREATE POLICY "canonical_jobs_read_authenticated" ON public.canonical_jobs FOR SELECT TO authenticated USING (true);
  
ALTER TABLE public.canonical_employers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.canonical_employers FROM anon, authenticated;
GRANT SELECT ON TABLE public.canonical_employers TO authenticated;
CREATE POLICY "canonical_employers_read_authenticated" ON public.canonical_employers FOR SELECT TO authenticated USING (true);
  
ALTER TABLE public.job_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_sources FROM anon, authenticated;
  
ALTER TABLE public.job_discovery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_discovery_events FROM anon, authenticated;
  
ALTER TABLE public.background_job_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.background_job_executions FROM anon, authenticated;
  
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
CREATE POLICY "audit_logs_read_own" ON public.audit_logs FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
  