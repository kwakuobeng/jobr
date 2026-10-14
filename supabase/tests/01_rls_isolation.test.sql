-- pgTAP: RLS / grant isolation for 0001 + 0002 (ownership + PostGIS hardening).
-- Proves: anon has zero access to every public app table; PostGIS catalogs
-- stay outside the exposed public schema; an authenticated user cannot read/write another user's rows; child
-- INSERT/UPDATE cannot attach to another user's parent FKs.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ---------------------------------------------------------------- helpers
CREATE SCHEMA tests;
GRANT USAGE ON SCHEMA tests TO anon, authenticated;

CREATE FUNCTION tests.affected(stmt text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION tests.affected(text) TO anon, authenticated;

CREATE FUNCTION tests.login(uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION tests.login(uuid) TO anon, authenticated;

CREATE TABLE tests.user_tables (tbl text PRIMARY KEY, owner_col text NOT NULL);
INSERT INTO tests.user_tables VALUES
  ('users_profile', 'id'), ('candidate_profiles', 'user_id'), ('resumes', 'user_id'),
  ('resume_versions', 'user_id'), ('extracted_experiences', 'user_id'), ('extracted_skills', 'user_id'),
  ('job_preferences', 'user_id'), ('saved_searches', 'user_id'), ('match_evaluations', 'user_id'),
  ('match_explanations', 'user_id'), ('recommendation_decisions', 'user_id'), ('applications', 'user_id'),
  ('application_attempts', 'user_id'), ('application_activity_history', 'user_id'), ('interviews', 'user_id'),
  ('reminders', 'user_id'), ('notifications', 'user_id'), ('email_digest_history', 'user_id');
GRANT SELECT ON tests.user_tables TO anon, authenticated;

CREATE TABLE tests.app_tables (tablename text PRIMARY KEY);
INSERT INTO tests.app_tables
  SELECT tbl FROM tests.user_tables
  UNION ALL SELECT unnest(ARRAY['audit_logs', 'background_job_executions', 'canonical_employers',
    'canonical_jobs', 'job_discovery_events', 'job_sources']);
GRANT SELECT ON tests.app_tables TO anon, authenticated;

-- ---------------------------------------------------------------- fixtures (superuser, bypasses RLS)
\set uid_a '''aaaaaaaa-0000-4000-8000-000000000001'''
\set uid_b '''bbbbbbbb-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES (:uid_a, 'a@test.local'), (:uid_b, 'b@test.local');

INSERT INTO public.canonical_employers (id, canonical_name, normalized_slug)
VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'Acme', 'acme');
INSERT INTO public.canonical_jobs (id, canonical_employer_id, identity_hash, description_simhash, title,
  normalized_title_slug, employer_name, description_plain, canonical_posting_url, application_url)
VALUES ('cccccccc-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'hash-1', 1,
  'Engineer', 'engineer', 'Acme', 'Build things', 'https://example.test/1', 'https://example.test/1');
INSERT INTO public.job_sources (provider_type, tenant_slug, display_name, base_endpoint_url)
VALUES ('greenhouse', 'acme', 'Acme GH', 'https://boards-api.greenhouse.io/v1/boards/acme/jobs');
INSERT INTO public.job_discovery_events (canonical_job_id, job_source_id, external_job_id, source_url, raw_payload_hash)
SELECT 'cccccccc-0000-4000-8000-000000000001', id, '1', 'https://example.test/1', 'p' FROM public.job_sources;

CREATE FUNCTION tests.seed_user(uid uuid, tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cp uuid; rs uuid; rv uuid; me uuid; ap uuid; job uuid := 'cccccccc-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO public.users_profile (id, email) VALUES (uid, tag || '@test.local');
  INSERT INTO public.candidate_profiles (user_id) VALUES (uid) RETURNING id INTO cp;
  INSERT INTO public.resumes (user_id, candidate_profile_id, original_filename, mime_type, storage_bucket_path,
    file_sha256, file_size_bytes, raw_extracted_text)
    VALUES (uid, cp, 'r.pdf', 'application/pdf', 'resumes/' || tag, 'sha', 100, 'text') RETURNING id INTO rs;
  INSERT INTO public.resume_versions (user_id, base_resume_id, version_label, normalized_profile_json)
    VALUES (uid, rs, 'v1', '{}') RETURNING id INTO rv;
  INSERT INTO public.extracted_experiences (user_id, candidate_profile_id, resume_id, employer_name, job_title, start_date)
    VALUES (uid, cp, rs, 'Acme', 'Eng', '2020-01-01');
  INSERT INTO public.extracted_skills (user_id, candidate_profile_id, resume_id, skill_slug, skill_display_name, category, evidence_type)
    VALUES (uid, cp, rs, 'ts', 'TypeScript', 'tool_tech', 'explicit_resume');
  INSERT INTO public.job_preferences (user_id, candidate_profile_id) VALUES (uid, cp);
  INSERT INTO public.saved_searches (user_id, candidate_profile_id, search_name, filter_criteria_json)
    VALUES (uid, cp, 's', '{}');
  INSERT INTO public.match_evaluations (user_id, candidate_profile_id, canonical_job_id, identity_hash, passed_hard_filters,
    overall_score, skill_score, semantic_score, experience_score, seniority_score, compensation_score, location_score,
    trajectory_score, recommendation_tier)
    VALUES (uid, cp, job, 'hash-1', true, 80, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 'strong_match') RETURNING id INTO me;
  INSERT INTO public.match_explanations (match_evaluation_id, user_id, why_it_matches_json, potential_concerns_json,
    summary_rationale, model_used) VALUES (me, uid, '[]', '[]', 'ok', 'test');
  INSERT INTO public.recommendation_decisions (user_id, candidate_profile_id, canonical_job_id, match_evaluation_id,
    identity_hash, decision) VALUES (uid, cp, job, me, 'hash-1', 'saved');
  INSERT INTO public.applications (user_id, candidate_profile_id, canonical_job_id, match_evaluation_id, selected_resume_version_id)
    VALUES (uid, cp, job, me, rv) RETURNING id INTO ap;
  INSERT INTO public.application_attempts (application_id, user_id, idempotency_key, execution_mode, attempt_number, status)
    VALUES (ap, uid, 'idem-' || tag, 'mode_a', 1, 'initiated');
  INSERT INTO public.application_activity_history (application_id, user_id, to_status, evidence_source)
    VALUES (ap, uid, 'saved', 'user_manual');
  INSERT INTO public.interviews (application_id, user_id, round_name, interview_type, scheduled_start_at)
    VALUES (ap, uid, 'R1', 'technical', now());
  INSERT INTO public.reminders (user_id, application_id, reminder_title, due_at) VALUES (uid, ap, 'follow up', now());
  INSERT INTO public.notifications (user_id, category, title, body) VALUES (uid, 'system_alert', 't', 'b');
  INSERT INTO public.email_digest_history (user_id, digest_date, idempotency_key) VALUES (uid, current_date, 'dig-' || tag);
  INSERT INTO public.background_job_executions (inngest_run_id, workflow_name, idempotency_key, user_id, status)
    VALUES ('run-' || tag, 'wf', 'k', uid, 'running');
  INSERT INTO public.audit_logs (user_id, actor_role, action_type, resource_table) VALUES (uid, 'candidate', 'test', 'resumes');
END $$;
SELECT tests.seed_user(:uid_a, 'a');
SELECT tests.seed_user(:uid_b, 'b');

-- SECURITY DEFINER lookups that simulate a leaked UUID (bypass RLS to read the id only)
CREATE FUNCTION tests.profile_of(uid uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.candidate_profiles WHERE user_id = uid $$;
CREATE FUNCTION tests.resume_of(uid uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.resumes WHERE user_id = uid $$;
CREATE FUNCTION tests.resume_version_of(uid uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.resume_versions WHERE user_id = uid $$;
CREATE FUNCTION tests.match_of(uid uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.match_evaluations WHERE user_id = uid $$;
CREATE FUNCTION tests.application_of(uid uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.applications WHERE user_id = uid $$;
GRANT EXECUTE ON FUNCTION tests.profile_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tests.resume_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tests.resume_version_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tests.match_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tests.application_of(uuid) TO authenticated;

-- ---------------------------------------------------------------- structural checks
SELECT is((SELECT count(*)::int FROM tests.app_tables), 24, 'fixture lists 24 application tables');
SELECT tables_are('public',
  ARRAY(SELECT tablename FROM tests.app_tables),
  'public contains exactly the 24 app tables; no PostGIS catalog exposure');
SELECT is(
  (SELECT count(*)::int FROM pg_tables p JOIN tests.app_tables a USING (tablename)
     WHERE p.schemaname = 'public' AND NOT p.rowsecurity), 0,
  'RLS enabled on every application table');
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants g JOIN tests.app_tables a ON a.tablename = g.table_name
     WHERE g.table_schema = 'public' AND g.grantee = 'anon'), 0,
  'anon holds no privileges on any application table');
SELECT policies_are('public', u.tbl,
  ARRAY[u.tbl || '_select_own', u.tbl || '_insert_own', u.tbl || '_update_own', u.tbl || '_delete_own'],
  u.tbl || ' has exactly the four own-row policies') FROM tests.user_tables u ORDER BY u.tbl;

-- ownership helpers from 0002 exist and are callable by authenticated only
SELECT has_function('public', 'owns_candidate_profile', ARRAY['uuid'], 'owns_candidate_profile helper exists');
SELECT has_function('public', 'owns_resume', ARRAY['uuid'], 'owns_resume helper exists');
SELECT has_function('public', 'owns_resume_version', ARRAY['uuid'], 'owns_resume_version helper exists');
SELECT has_function('public', 'owns_match_evaluation', ARRAY['uuid'], 'owns_match_evaluation helper exists');
SELECT has_function('public', 'owns_application', ARRAY['uuid'], 'owns_application helper exists');

-- ---------------------------------------------------------------- PostGIS stays outside exposed schemas
SELECT is((SELECT n.nspname::text FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'postgis'), 'extensions', 'PostGIS installed in unexposed extensions schema');
SELECT ok(to_regclass('extensions.spatial_ref_sys') IS NOT NULL, 'PostGIS reference catalog still exists');
SELECT ok(to_regclass('public.spatial_ref_sys') IS NULL, 'spatial_ref_sys not exposed in public');
SELECT ok(to_regclass('public.geometry_columns') IS NULL, 'geometry_columns not exposed in public');
SELECT ok(to_regclass('public.geography_columns') IS NULL, 'geography_columns not exposed in public');
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT * FROM public.spatial_ref_sys', '42P01', NULL, 'anon cannot access a public PostGIS catalog endpoint');
RESET ROLE;

-- ---------------------------------------------------------------- anon: zero access to app tables
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT throws_ok(format('SELECT * FROM public.%I', t.tablename), '42501', NULL, 'anon cannot SELECT ' || t.tablename)
  FROM tests.app_tables t ORDER BY t.tablename;
SELECT throws_ok(format('DELETE FROM public.%I', t.tablename), '42501', NULL, 'anon cannot DELETE ' || t.tablename)
  FROM tests.app_tables t ORDER BY t.tablename;
SELECT throws_ok(format('INSERT INTO public.%I DEFAULT VALUES', t.tablename), '42501', NULL, 'anon cannot INSERT ' || t.tablename)
  FROM tests.app_tables t ORDER BY t.tablename;
RESET ROLE;

-- ---------------------------------------------------------------- user A sees only own rows
SET LOCAL ROLE authenticated;
SELECT tests.login(:uid_a);
SELECT is(tests.affected(format('SELECT 1 FROM public.%I', u.tbl)), 1, 'A sees exactly own 1 row in ' || u.tbl)
  FROM tests.user_tables u ORDER BY u.tbl;
SELECT is(tests.affected('SELECT 1 FROM public.audit_logs'), 1, 'A sees exactly own 1 row in audit_logs');

-- ---------------------------------------------------------------- user B vs user A's rows
SELECT tests.login(:uid_b);
SELECT is(tests.affected(format('SELECT 1 FROM public.%I WHERE %I = %L', u.tbl, u.owner_col, :uid_a)), 0,
  'B cannot read A rows in ' || u.tbl) FROM tests.user_tables u ORDER BY u.tbl;
SELECT is(tests.affected(format('SELECT 1 FROM public.audit_logs WHERE user_id = %L', :uid_a)), 0,
  'B cannot read A rows in audit_logs');

SELECT is(tests.affected(format('UPDATE public.%I SET %I = %I WHERE %I = %L', u.tbl, u.owner_col, u.owner_col, u.owner_col, :uid_a)), 0,
  'B cannot UPDATE A rows in ' || u.tbl) FROM tests.user_tables u ORDER BY u.tbl;
SELECT is(tests.affected(format('DELETE FROM public.%I WHERE %I = %L', u.tbl, u.owner_col, :uid_a)), 0,
  'B cannot DELETE A rows in ' || u.tbl) FROM tests.user_tables u ORDER BY u.tbl;

SELECT throws_ok(format('UPDATE public.%I SET %I = %L WHERE %I = %L', u.tbl, u.owner_col, :uid_a, u.owner_col, :uid_b),
  '42501', NULL, 'B cannot reassign own row to A in ' || u.tbl)
  FROM tests.user_tables u WHERE u.tbl <> 'users_profile' ORDER BY u.tbl;

SELECT throws_ok(format(
  'INSERT INTO public.%1$I SELECT (jsonb_populate_record(NULL::public.%1$I, to_jsonb(r) || jsonb_build_object(''id'', gen_random_uuid(), %2$L, %3$L::uuid))).* FROM public.%1$I r WHERE r.%2$I = %4$L',
  u.tbl, u.owner_col, :uid_a, :uid_b),
  '42501', NULL, 'B cannot INSERT-as-A into ' || u.tbl) FROM tests.user_tables u ORDER BY u.tbl;

-- audit_logs: select-own only, no writes
SELECT throws_ok(format('INSERT INTO public.audit_logs (user_id, actor_role, action_type, resource_table) VALUES (%L, ''x'', ''x'', ''x'')', :uid_b),
  '42501', NULL, 'authenticated cannot INSERT audit_logs');
SELECT throws_ok('UPDATE public.audit_logs SET action_type = ''x''', '42501', NULL, 'authenticated cannot UPDATE audit_logs');
SELECT throws_ok('DELETE FROM public.audit_logs', '42501', NULL, 'authenticated cannot DELETE audit_logs');

-- ---------------------------------------------------------------- cross-tenant FK attachment (0002 ownership checks)
-- B knows A's UUIDs but must not be able to point child FKs at them.
SELECT throws_ok(format(
  'INSERT INTO public.saved_searches (user_id, candidate_profile_id, search_name, filter_criteria_json) VALUES (%L, %L, ''x'', ''{}'')',
  :uid_b, tests.profile_of(:uid_a)),
  '42501', NULL, 'B cannot attach saved_searches to A''s candidate_profile');

SELECT throws_ok(format(
  'INSERT INTO public.resumes (user_id, candidate_profile_id, original_filename, mime_type, storage_bucket_path, file_sha256, file_size_bytes, raw_extracted_text) VALUES (%L, %L, ''x.pdf'', ''application/pdf'', ''resumes/b-leak'', ''sha2'', 100, ''t'')',
  :uid_b, tests.profile_of(:uid_a)),
  '42501', NULL, 'B cannot attach resumes to A''s candidate_profile');

SELECT throws_ok(format(
  'INSERT INTO public.resume_versions (user_id, base_resume_id, version_label, normalized_profile_json) VALUES (%L, %L, ''x'', ''{}'')',
  :uid_b, tests.resume_of(:uid_a)),
  '42501', NULL, 'B cannot attach resume_versions to A''s resume');

SELECT throws_ok(format(
  'INSERT INTO public.extracted_experiences (user_id, candidate_profile_id, resume_id, employer_name, job_title, start_date) VALUES (%L, %L, %L, ''X'', ''Y'', ''2021-01-01'')',
  :uid_b, tests.profile_of(:uid_a), tests.resume_of(:uid_b)),
  '42501', NULL, 'B cannot attach extracted_experiences to A''s candidate_profile');

SELECT throws_ok(format(
  'INSERT INTO public.extracted_experiences (user_id, candidate_profile_id, resume_id, employer_name, job_title, start_date) VALUES (%L, %L, %L, ''X'', ''Y'', ''2021-01-01'')',
  :uid_b, tests.profile_of(:uid_b), tests.resume_of(:uid_a)),
  '42501', NULL, 'B cannot attach extracted_experiences to A''s resume');

SELECT throws_ok(format(
  'INSERT INTO public.extracted_skills (user_id, candidate_profile_id, skill_slug, skill_display_name, category, evidence_type) VALUES (%L, %L, ''leak'', ''Leak'', ''hard_skill'', ''user_verified_addition'')',
  :uid_b, tests.profile_of(:uid_a)),
  '42501', NULL, 'B cannot attach extracted_skills to A''s candidate_profile');

SELECT throws_ok(format(
  'INSERT INTO public.match_evaluations (user_id, candidate_profile_id, canonical_job_id, identity_hash, passed_hard_filters, overall_score, skill_score, semantic_score, experience_score, seniority_score, compensation_score, location_score, trajectory_score, recommendation_tier) VALUES (%L, %L, ''cccccccc-0000-4000-8000-000000000001'', ''hash-b-a'', true, 1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, ''poor_fit'')',
  :uid_b, tests.profile_of(:uid_a)),
  '42501', NULL, 'B cannot attach match_evaluations to A''s candidate_profile');

SELECT throws_ok(format(
  'INSERT INTO public.match_explanations (match_evaluation_id, user_id, why_it_matches_json, potential_concerns_json, summary_rationale, model_used) VALUES (%L, %L, ''[]'', ''[]'', ''x'', ''t'')',
  tests.match_of(:uid_a), :uid_b),
  '42501', NULL, 'B cannot attach match_explanations to A''s match_evaluation');

SELECT throws_ok(format(
  'INSERT INTO public.recommendation_decisions (user_id, candidate_profile_id, canonical_job_id, match_evaluation_id, identity_hash, decision) VALUES (%L, %L, ''cccccccc-0000-4000-8000-000000000001'', %L, ''h'', ''pending'')',
  :uid_b, tests.profile_of(:uid_b), tests.match_of(:uid_a)),
  '42501', NULL, 'B cannot attach recommendation_decisions to A''s match_evaluation');

-- second shared job so applications UNIQUE (user_id, canonical_job_id) is not the failure mode
RESET ROLE;
INSERT INTO public.canonical_jobs (id, canonical_employer_id, identity_hash, description_simhash, title,
  normalized_title_slug, employer_name, description_plain, canonical_posting_url, application_url)
VALUES ('cccccccc-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001', 'hash-2', 2,
  'Designer', 'designer', 'Acme', 'Design things', 'https://example.test/2', 'https://example.test/2');
SET LOCAL ROLE authenticated;
SELECT tests.login(:uid_b);

SELECT throws_ok(format(
  'INSERT INTO public.applications (user_id, candidate_profile_id, canonical_job_id, match_evaluation_id) VALUES (%L, %L, ''cccccccc-0000-4000-8000-000000000002'', %L)',
  :uid_b, tests.profile_of(:uid_b), tests.match_of(:uid_a)),
  '42501', NULL, 'B cannot attach applications to A''s match_evaluation');

SELECT throws_ok(format(
  'INSERT INTO public.applications (user_id, candidate_profile_id, canonical_job_id, selected_resume_version_id) VALUES (%L, %L, ''cccccccc-0000-4000-8000-000000000002'', %L)',
  :uid_b, tests.profile_of(:uid_b), tests.resume_version_of(:uid_a)),
  '42501', NULL, 'B cannot attach applications to A''s resume_version');

SELECT throws_ok(format(
  'INSERT INTO public.application_attempts (application_id, user_id, idempotency_key, execution_mode, attempt_number, status) VALUES (%L, %L, ''idem-b-a'', ''mode_a'', 1, ''initiated'')',
  tests.application_of(:uid_a), :uid_b),
  '42501', NULL, 'B cannot attach application_attempts to A''s application');

SELECT throws_ok(format(
  'INSERT INTO public.application_activity_history (application_id, user_id, to_status, evidence_source) VALUES (%L, %L, ''saved'', ''user_manual'')',
  tests.application_of(:uid_a), :uid_b),
  '42501', NULL, 'B cannot attach application_activity_history to A''s application');

SELECT throws_ok(format(
  'INSERT INTO public.interviews (application_id, user_id, round_name, interview_type, scheduled_start_at) VALUES (%L, %L, ''R'', ''technical'', now())',
  tests.application_of(:uid_a), :uid_b),
  '42501', NULL, 'B cannot attach interviews to A''s application');

SELECT throws_ok(format(
  'INSERT INTO public.reminders (user_id, application_id, reminder_title, due_at) VALUES (%L, %L, ''x'', now())',
  :uid_b, tests.application_of(:uid_a)),
  '42501', NULL, 'B cannot attach reminders to A''s application');

-- B also cannot UPDATE its own row to point at A's parent
SELECT throws_ok(format(
  'UPDATE public.saved_searches SET candidate_profile_id = %L WHERE user_id = %L',
  tests.profile_of(:uid_a), :uid_b),
  '42501', NULL, 'B cannot re-point saved_searches at A''s candidate_profile');

SELECT throws_ok(format(
  'UPDATE public.reminders SET application_id = %L WHERE user_id = %L',
  tests.application_of(:uid_a), :uid_b),
  '42501', NULL, 'B cannot re-point reminders at A''s application');

-- positive control: B can still insert against B's own parents
SELECT lives_ok(format(
  'INSERT INTO public.saved_searches (user_id, candidate_profile_id, search_name, filter_criteria_json) VALUES (%L, %L, ''own'', ''{}'')',
  :uid_b, tests.profile_of(:uid_b)),
  'B can attach saved_searches to B''s own candidate_profile');

-- service-only tables
SELECT throws_ok(format('SELECT * FROM public.%I', t), '42501', NULL, 'authenticated cannot SELECT ' || t)
  FROM unnest(ARRAY['job_sources', 'job_discovery_events', 'background_job_executions']) t;

-- shared catalog: read-only
SELECT cmp_ok(tests.affected('SELECT 1 FROM public.' || t), '>=', 1, 'authenticated can read ' || t)
  FROM unnest(ARRAY['canonical_jobs', 'canonical_employers']) t;
SELECT throws_ok(format('DELETE FROM public.%I', t), '42501', NULL, 'authenticated cannot DELETE ' || t)
  FROM unnest(ARRAY['canonical_jobs', 'canonical_employers']) t;
SELECT throws_ok(format('UPDATE public.%I SET id = id', t), '42501', NULL, 'authenticated cannot UPDATE ' || t)
  FROM unnest(ARRAY['canonical_jobs', 'canonical_employers']) t;
SELECT throws_ok('INSERT INTO public.canonical_employers (canonical_name, normalized_slug) VALUES (''x'', ''x'')',
  '42501', NULL, 'authenticated cannot INSERT canonical_employers');

-- unauthenticated JWT (no sub) under authenticated role sees nothing user-scoped
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(tests.affected(format('SELECT 1 FROM public.%I', u.tbl)), 0, 'no-sub session sees 0 rows in ' || u.tbl)
  FROM tests.user_tables u ORDER BY u.tbl;
RESET ROLE;

-- ---------------------------------------------------------------- A's data intact after B's attempts
SELECT is(tests.affected(format('SELECT 1 FROM public.%I WHERE %I = %L', u.tbl, u.owner_col, :uid_a)), 1,
  'A row still present (superuser view) in ' || u.tbl) FROM tests.user_tables u ORDER BY u.tbl;

SELECT * FROM finish();
ROLLBACK;
