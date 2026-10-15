-- pgTAP: 0006 ranking legs + users_profile signup trigger.
BEGIN;
SELECT plan(16);

-- Isolation: hide any pre-existing jobs (e.g. hosted QA/prototype rows) for the life of this
-- transaction; Stage 1 only admits status = 'active'. Rolled back with the test.
UPDATE public.canonical_jobs SET status = 'closed' WHERE status = 'active';

-- The signup trigger creates users_profile; this file never inserts it by hand.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('d4444444-4444-4444-8444-444444444444', '  Rank.User@Jobr.Test ', '{"full_name":"Rank User"}');
INSERT INTO public.candidate_profiles (id, user_id, profile_name)
VALUES ('c4444444-4444-4444-8444-444444444444', 'd4444444-4444-4444-8444-444444444444', 'Ranking profile');
INSERT INTO public.canonical_employers (id, canonical_name, normalized_slug, primary_domain)
VALUES ('e4444444-4444-4444-8444-444444444444', 'RankCo', 'rankco', 'rankco.example');

-- Recency (newest first): jB, jZ, jA -- deliberately different from id order (jZ, jB, jA).
-- jZ: zero lexical score for the query, lowest id (0005 gave it semantic rank 1 by id order).
-- jA: real match ("backend engineer"), oldest, highest id.  jB: weaker match.  jX: part-time (hard-filtered).
INSERT INTO public.canonical_jobs (id, canonical_employer_id, identity_hash, description_simhash, title, normalized_title_slug,
  employer_name, workplace_type, employment_type, description_plain, canonical_posting_url, application_url, original_published_at)
VALUES
  ('00000000-0000-4000-8000-0000000000a0', 'e4444444-4444-4444-8444-444444444444', 'rank_z', 1, 'Managing Director North', 'managing-director-north',
   'RankCo', 'remote', 'full_time', 'Lead regional sales partnerships.', 'https://rankco.example/z', 'https://rankco.example/z', now() - interval '10 days'),
  ('ffffffff-0000-4000-8000-0000000000a1', 'e4444444-4444-4444-8444-444444444444', 'rank_a', 2, 'Senior Backend Software Engineer', 'senior-backend-software-engineer',
   'RankCo', 'remote', 'full_time', 'Build backend services; backend engineer owning APIs.', 'https://rankco.example/a', 'https://rankco.example/a', now() - interval '30 days'),
  ('88888888-0000-4000-8000-0000000000a2', 'e4444444-4444-4444-8444-444444444444', 'rank_b', 3, 'Platform Engineer', 'platform-engineer',
   'RankCo', 'remote', 'full_time', 'Infrastructure and backend tooling.', 'https://rankco.example/b', 'https://rankco.example/b', now() - interval '1 day'),
  ('11111111-0000-4000-8000-0000000000a3', 'e4444444-4444-4444-8444-444444444444', 'rank_x', 4, 'Backend Engineer (part-time)', 'backend-engineer-part-time',
   'RankCo', 'remote', 'part_time', 'Backend engineer, part-time.', 'https://rankco.example/x', 'https://rankco.example/x', now());

-- ---------------------------------------------------------------- signup trigger
SELECT is((SELECT email FROM public.users_profile WHERE id = 'd4444444-4444-4444-8444-444444444444'), 'rank.user@jobr.test',
  'signup trigger created users_profile with a normalized email');
SELECT is((SELECT full_name FROM public.users_profile WHERE id = 'd4444444-4444-4444-8444-444444444444'), 'Rank User',
  'signup trigger copies full_name from raw_user_meta_data');
SELECT lives_ok($$INSERT INTO auth.users (id, email) VALUES ('d5555555-5555-4555-8555-555555555555', NULL)$$,
  'signup without an email does not fail');
SELECT is((SELECT count(*)::int FROM public.users_profile WHERE id = 'd5555555-5555-4555-8555-555555555555'), 0,
  'no users_profile is created for an email-less user');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.handle_new_auth_user()'::regprocedure),
  'trigger function is SECURITY DEFINER with an empty search_path');
SELECT ok(NOT has_function_privilege('authenticated', 'public.handle_new_auth_user()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.handle_new_auth_user()', 'EXECUTE'),
  'API roles cannot execute the trigger function directly');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'match_jobs_hybrid' AND pronamespace = 'public'::regnamespace), 1,
  'still exactly one match_jobs_hybrid overload');

-- ---------------------------------------------------------------- ranking (as the owner)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d4444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c4444444-4444-4444-8444-444444444444', 'backend engineer')
  WHERE canonical_job_id = '00000000-0000-4000-8000-0000000000a0'$$,
  'zero-score job (jZ) is no longer returned when the query has real matches');
SELECT is((SELECT canonical_job_id FROM public.match_jobs_hybrid('c4444444-4444-4444-8444-444444444444', 'backend engineer') LIMIT 1),
  'ffffffff-0000-4000-8000-0000000000a1'::uuid, 'the strongest real lexical match ranks first');
SELECT ok((SELECT bool_and(lexical_rank > 0) AND bool_and(semantic_similarity = 0)
           FROM public.match_jobs_hybrid('c4444444-4444-4444-8444-444444444444', 'backend engineer')),
  'null embedding: semantic leg absent, every returned row is a real lexical match');
SELECT results_eq(
  $$SELECT canonical_job_id FROM public.match_jobs_hybrid('c4444444-4444-4444-8444-444444444444', 'zzzqqqxyz')$$,
  ARRAY['88888888-0000-4000-8000-0000000000a2'::uuid, '00000000-0000-4000-8000-0000000000a0'::uuid, 'ffffffff-0000-4000-8000-0000000000a1'::uuid],
  'no embedding + no lexical match: recency fallback, newest first');
SELECT results_eq(
  $$SELECT canonical_job_id FROM public.match_jobs_hybrid('c4444444-4444-4444-8444-444444444444', '')$$,
  ARRAY['88888888-0000-4000-8000-0000000000a2'::uuid, '00000000-0000-4000-8000-0000000000a0'::uuid, 'ffffffff-0000-4000-8000-0000000000a1'::uuid],
  'no embedding + empty query: recency fallback');
SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c4444444-4444-4444-8444-444444444444', '')
  WHERE canonical_job_id = '11111111-0000-4000-8000-0000000000a3'$$,
  'hard filters still apply before the recency fallback (part-time job excluded)');

-- ---------------------------------------------------------------- with embeddings
RESET ROLE;
UPDATE public.candidate_profiles SET target_job_embedding = array_fill(0.02::real, ARRAY[1536])::vector(1536)
  WHERE id = 'c4444444-4444-4444-8444-444444444444';
UPDATE public.canonical_jobs SET requirements_embedding = array_fill(0.02::real, ARRAY[1536])::vector(1536)
  WHERE id = 'ffffffff-0000-4000-8000-0000000000a1';
UPDATE public.canonical_jobs SET requirements_embedding = (ARRAY[0.9::real] || array_fill(0.02::real, ARRAY[1535]))::vector(1536)
  WHERE id = '88888888-0000-4000-8000-0000000000a2';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d4444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

SELECT results_eq(
  $$SELECT canonical_job_id FROM public.match_jobs_hybrid('c4444444-4444-4444-8444-444444444444', '')$$,
  ARRAY['ffffffff-0000-4000-8000-0000000000a1'::uuid, '88888888-0000-4000-8000-0000000000a2'::uuid],
  'embedding present, empty query: only embedded jobs, ordered by similarity (no fallback, no jZ)');
SELECT ok((SELECT bool_and(semantic_similarity > 0) FROM public.match_jobs_hybrid('c4444444-4444-4444-8444-444444444444', '')),
  'semantic similarity is real for every returned row');
SELECT throws_ok($$SELECT * FROM public.match_jobs_hybrid('c4444444-4444-4444-8444-444444444444', '', false, 60, 51)$$,
  '22023', NULL, 'p_top_n bound unchanged');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
