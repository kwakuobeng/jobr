-- Jobr M1.1 security hardening (follows 0001_initial_schema.sql; does NOT edit 0001).
--
-- Fixes confirmed in pgTAP against 0001 alone:
--   1) Child INSERT/UPDATE policies only checked user_id = auth.uid(), so a caller who
--      learned another user's candidate_profile / resume / application / match_evaluation UUID
--      could attach their own rows to that parent (FK checks ignore RLS).
--   2) CREATE EXTENSION postgis in public left spatial_ref_sys (and related catalog objects)
--      without RLS and granted to PUBLIC. Install PostGIS in extensions in 0001.
--
-- Migration numbering note: blueprint T-103 wants 0002_storage_rls and T-401 wants a hybrid
-- RPC as 0002/0003. This file claims 0002 for the security fix; rename later blueprint
-- migrations to 0003_storage_rls.sql and 0004_hybrid_match_rpc.sql (or similar).

-- ---------------------------------------------------------------------------
-- 1) Ownership helpers (SECURITY DEFINER so the EXISTS check is not blocked by
--    parent-table RLS when evaluating WITH CHECK. The user_id = auth.uid()
--    predicate is the real authorization; search_path is pinned.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owns_candidate_profile(profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.candidate_profiles
    WHERE id = profile_id
      AND user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_resume(resume_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.resumes
    WHERE id = resume_id
      AND user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_resume_version(version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.resume_versions
    WHERE id = version_id
      AND user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_match_evaluation(evaluation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_evaluations
    WHERE id = evaluation_id
      AND user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_application(application_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications
    WHERE id = application_id
      AND user_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.owns_candidate_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owns_resume(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owns_resume_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owns_match_evaluation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owns_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_candidate_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_resume(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_resume_version(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_match_evaluation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_application(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Replace INSERT/UPDATE policies on every child that FKs a user-owned parent.
--    SELECT/DELETE stay on user_id alone (sufficient once writes cannot cross tenants).
--    Nullable FKs: NULL is allowed; a non-NULL target must be owned by auth.uid().
-- ---------------------------------------------------------------------------

-- resumes → candidate_profiles
DROP POLICY IF EXISTS "resumes_insert_own" ON public.resumes;
DROP POLICY IF EXISTS "resumes_update_own" ON public.resumes;
CREATE POLICY "resumes_insert_own" ON public.resumes
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
  );
CREATE POLICY "resumes_update_own" ON public.resumes
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
  );

-- resume_versions → resumes
DROP POLICY IF EXISTS "resume_versions_insert_own" ON public.resume_versions;
DROP POLICY IF EXISTS "resume_versions_update_own" ON public.resume_versions;
CREATE POLICY "resume_versions_insert_own" ON public.resume_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_resume(base_resume_id)
  );
CREATE POLICY "resume_versions_update_own" ON public.resume_versions
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_resume(base_resume_id)
  );

-- extracted_experiences → candidate_profiles, resumes (nullable)
DROP POLICY IF EXISTS "extracted_experiences_insert_own" ON public.extracted_experiences;
DROP POLICY IF EXISTS "extracted_experiences_update_own" ON public.extracted_experiences;
CREATE POLICY "extracted_experiences_insert_own" ON public.extracted_experiences
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
    AND (resume_id IS NULL OR public.owns_resume(resume_id))
  );
CREATE POLICY "extracted_experiences_update_own" ON public.extracted_experiences
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
    AND (resume_id IS NULL OR public.owns_resume(resume_id))
  );

-- extracted_skills → candidate_profiles, resumes (nullable)
DROP POLICY IF EXISTS "extracted_skills_insert_own" ON public.extracted_skills;
DROP POLICY IF EXISTS "extracted_skills_update_own" ON public.extracted_skills;
CREATE POLICY "extracted_skills_insert_own" ON public.extracted_skills
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
    AND (resume_id IS NULL OR public.owns_resume(resume_id))
  );
CREATE POLICY "extracted_skills_update_own" ON public.extracted_skills
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
    AND (resume_id IS NULL OR public.owns_resume(resume_id))
  );

-- job_preferences → candidate_profiles
DROP POLICY IF EXISTS "job_preferences_insert_own" ON public.job_preferences;
DROP POLICY IF EXISTS "job_preferences_update_own" ON public.job_preferences;
CREATE POLICY "job_preferences_insert_own" ON public.job_preferences
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
  );
CREATE POLICY "job_preferences_update_own" ON public.job_preferences
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
  );

-- saved_searches → candidate_profiles
DROP POLICY IF EXISTS "saved_searches_insert_own" ON public.saved_searches;
DROP POLICY IF EXISTS "saved_searches_update_own" ON public.saved_searches;
CREATE POLICY "saved_searches_insert_own" ON public.saved_searches
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
  );
CREATE POLICY "saved_searches_update_own" ON public.saved_searches
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
  );

-- match_evaluations → candidate_profiles (canonical_job_id is shared catalog)
DROP POLICY IF EXISTS "match_evaluations_insert_own" ON public.match_evaluations;
DROP POLICY IF EXISTS "match_evaluations_update_own" ON public.match_evaluations;
CREATE POLICY "match_evaluations_insert_own" ON public.match_evaluations
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
  );
CREATE POLICY "match_evaluations_update_own" ON public.match_evaluations
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
  );

-- match_explanations → match_evaluations
DROP POLICY IF EXISTS "match_explanations_insert_own" ON public.match_explanations;
DROP POLICY IF EXISTS "match_explanations_update_own" ON public.match_explanations;
CREATE POLICY "match_explanations_insert_own" ON public.match_explanations
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_match_evaluation(match_evaluation_id)
  );
CREATE POLICY "match_explanations_update_own" ON public.match_explanations
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_match_evaluation(match_evaluation_id)
  );

-- recommendation_decisions → candidate_profiles, match_evaluations
DROP POLICY IF EXISTS "recommendation_decisions_insert_own" ON public.recommendation_decisions;
DROP POLICY IF EXISTS "recommendation_decisions_update_own" ON public.recommendation_decisions;
CREATE POLICY "recommendation_decisions_insert_own" ON public.recommendation_decisions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
    AND public.owns_match_evaluation(match_evaluation_id)
  );
CREATE POLICY "recommendation_decisions_update_own" ON public.recommendation_decisions
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
    AND public.owns_match_evaluation(match_evaluation_id)
  );

-- applications → candidate_profiles, match_evaluations (nullable), resume_versions (nullable)
DROP POLICY IF EXISTS "applications_insert_own" ON public.applications;
DROP POLICY IF EXISTS "applications_update_own" ON public.applications;
CREATE POLICY "applications_insert_own" ON public.applications
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
    AND (match_evaluation_id IS NULL OR public.owns_match_evaluation(match_evaluation_id))
    AND (selected_resume_version_id IS NULL OR public.owns_resume_version(selected_resume_version_id))
  );
CREATE POLICY "applications_update_own" ON public.applications
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_candidate_profile(candidate_profile_id)
    AND (match_evaluation_id IS NULL OR public.owns_match_evaluation(match_evaluation_id))
    AND (selected_resume_version_id IS NULL OR public.owns_resume_version(selected_resume_version_id))
  );

-- application_attempts → applications
DROP POLICY IF EXISTS "application_attempts_insert_own" ON public.application_attempts;
DROP POLICY IF EXISTS "application_attempts_update_own" ON public.application_attempts;
CREATE POLICY "application_attempts_insert_own" ON public.application_attempts
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_application(application_id)
  );
CREATE POLICY "application_attempts_update_own" ON public.application_attempts
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_application(application_id)
  );

-- application_activity_history → applications
DROP POLICY IF EXISTS "application_activity_history_insert_own" ON public.application_activity_history;
DROP POLICY IF EXISTS "application_activity_history_update_own" ON public.application_activity_history;
CREATE POLICY "application_activity_history_insert_own" ON public.application_activity_history
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_application(application_id)
  );
CREATE POLICY "application_activity_history_update_own" ON public.application_activity_history
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_application(application_id)
  );

-- interviews → applications
DROP POLICY IF EXISTS "interviews_insert_own" ON public.interviews;
DROP POLICY IF EXISTS "interviews_update_own" ON public.interviews;
CREATE POLICY "interviews_insert_own" ON public.interviews
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_application(application_id)
  );
CREATE POLICY "interviews_update_own" ON public.interviews
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.owns_application(application_id)
  );

-- reminders → applications (nullable)
DROP POLICY IF EXISTS "reminders_insert_own" ON public.reminders;
DROP POLICY IF EXISTS "reminders_update_own" ON public.reminders;
CREATE POLICY "reminders_insert_own" ON public.reminders
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (application_id IS NULL OR public.owns_application(application_id))
  );
CREATE POLICY "reminders_update_own" ON public.reminders
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (application_id IS NULL OR public.owns_application(application_id))
  );

-- ---------------------------------------------------------------------------
-- 3) PostGIS catalog placement.
--    0001 installs PostGIS in the unexposed extensions schema. Do not ALTER
--    extension-owned tables: Supabase's postgres role does not own them.
--    Fail closed if a pre-existing public installation exposes catalog objects.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.spatial_ref_sys') IS NOT NULL
     OR to_regclass('public.geometry_columns') IS NOT NULL
     OR to_regclass('public.geography_columns') IS NOT NULL THEN
    RAISE EXCEPTION 'PostGIS catalog objects must not be exposed in public';
  END IF;
END $$;
