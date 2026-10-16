-- pgTAP: 0009 match quality (region filter before top-N, office-duplicate merge, employer cap,
-- title-weighted lexical rank, ingest_job_batch, 768-dim embeddings, privileges).
BEGIN;
SELECT plan(16);
UPDATE public.canonical_jobs SET status = 'closed' WHERE status = 'active';

INSERT INTO auth.users (id, email) VALUES ('d7777777-7777-4777-8777-777777777777', 'mq@jobr.test');
INSERT INTO public.candidate_profiles (id, user_id, profile_name)
VALUES ('c7777777-7777-4777-8777-777777777777', 'd7777777-7777-4777-8777-777777777777', 'MQ');
INSERT INTO public.canonical_employers (id, canonical_name, normalized_slug, primary_domain) VALUES
  ('e7777777-0000-4000-8000-000000000001', 'Alpha', 'alpha-mq', 'alpha-mq.example'),
  ('e7777777-0000-4000-8000-000000000002', 'Zeta', 'zeta-mq', 'zeta-mq.example');

-- Alpha: four AE roles (one in the title, three only in the description); Zeta: one AE role.
INSERT INTO public.canonical_jobs (id, canonical_employer_id, identity_hash, description_simhash, title, normalized_title_slug,
  employer_name, workplace_type, employment_type, description_plain, canonical_posting_url, application_url, region, country_codes, locations_json)
VALUES
  ('a7000000-0000-4000-8000-000000000001', 'e7777777-0000-4000-8000-000000000001', 'mq1', 1, 'Account Executive', 'account-executive',
   'Alpha', 'hybrid', 'full_time', 'Sell software.', 'https://a.example/1', 'https://a.example/1', 'us', '{US}', '["Seattle Office"]'),
  ('a7000000-0000-4000-8000-000000000002', 'e7777777-0000-4000-8000-000000000001', 'mq2', 2, 'Data Engineer', 'data-engineer',
   'Alpha', 'remote', 'full_time', 'Work with the account executive team and account executive tooling, account executive.', 'https://a.example/2', 'https://a.example/2', 'us', '{US}', '["Remote - US"]'),
  ('a7000000-0000-4000-8000-000000000003', 'e7777777-0000-4000-8000-000000000001', 'mq3', 3, 'Platform Engineer', 'platform-engineer',
   'Alpha', 'remote', 'full_time', 'Supports account executive workflows.', 'https://a.example/3', 'https://a.example/3', 'non_us', '{GB}', '["Remote - UK"]'),
  ('a7000000-0000-4000-8000-000000000004', 'e7777777-0000-4000-8000-000000000001', 'mq4', 4, 'Solutions Engineer', 'solutions-engineer',
   'Alpha', 'remote', 'full_time', 'Pairs with each account executive.', 'https://a.example/4', 'https://a.example/4', 'unknown', '{}', '["Remote"]'),
  ('a7000000-0000-4000-8000-000000000005', 'e7777777-0000-4000-8000-000000000002', 'mq5', 5, 'Enterprise Account Executive', 'enterprise-account-executive',
   'Zeta', 'onsite', 'full_time', 'Close deals.', 'https://z.example/5', 'https://z.example/5', 'non_us', '{DE}', '["Berlin Office"]'),
  -- per-office copy of mq1 (New York): merged away by merge_duplicate_postings()
  ('a7000000-0000-4000-8000-000000000006', 'e7777777-0000-4000-8000-000000000001', 'mq6', 6, 'Account Executive', 'account-executive',
   'Alpha', 'hybrid', 'full_time', 'Sell software.', 'https://a.example/6', 'https://a.example/6', 'us', '{US}', '["New York Office"]');

SELECT is(public.merge_duplicate_postings(), 1, 'one per-office copy merged');
SELECT is((SELECT duplicate_of FROM public.canonical_jobs WHERE id = 'a7000000-0000-4000-8000-000000000006'),
  'a7000000-0000-4000-8000-000000000001'::uuid, 'copy points at the keeper');
SELECT is((SELECT locations_json FROM public.canonical_jobs WHERE id = 'a7000000-0000-4000-8000-000000000001'),
  '["Seattle Office", "New York Office"]'::jsonb, 'keeper keeps every office location');
SELECT is(public.merge_duplicate_postings(), 0, 'merge is idempotent');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d7777777-7777-4777-8777-777777777777","role":"authenticated"}', true);

SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c7777777-7777-4777-8777-777777777777', '"account executive"')
  WHERE canonical_job_id = 'a7000000-0000-4000-8000-000000000006'$$, 'merged copies are never ranked');
SELECT is((SELECT canonical_job_id FROM public.match_jobs_hybrid('c7777777-7777-4777-8777-777777777777', '"account executive"', p_max_per_employer => 50) LIMIT 1),
  'a7000000-0000-4000-8000-000000000001'::uuid, 'title match outranks a description stuffed with the phrase');
SELECT results_eq(
  $$SELECT canonical_job_id FROM public.match_jobs_hybrid('c7777777-7777-4777-8777-777777777777', '"account executive"', p_region => 'us')$$,
  ARRAY['a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000002'::uuid],
  'region = us filters in SQL before the top-N cut');
SELECT set_eq(
  $$SELECT canonical_job_id FROM public.match_jobs_hybrid('c7777777-7777-4777-8777-777777777777', '"account executive"', p_us_or_remote_only => true)$$,
  ARRAY['a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000002'::uuid, 'a7000000-0000-4000-8000-000000000004'::uuid],
  'US-or-Remote keeps US roles and remote roles with no stated non-US region');
SELECT results_eq(
  $$SELECT employer_name FROM public.match_jobs_hybrid('c7777777-7777-4777-8777-777777777777', '"account executive"', p_max_per_employer => 1) LIMIT 2$$,
  ARRAY['Alpha'::text, 'Zeta'::text], 'employer cap interleaves companies at the top');
SELECT is((SELECT count(*)::int FROM public.match_jobs_hybrid('c7777777-7777-4777-8777-777777777777', '"account executive"', p_max_per_employer => 1)), 5,
  'employer cap reorders but still fills the list');
SELECT throws_ok($$SELECT * FROM public.match_jobs_hybrid('c7777777-7777-4777-8777-777777777777', '', p_region => 'mars')$$, '22023', NULL, 'invalid region rejected');
SELECT throws_ok($$SELECT public.merge_duplicate_postings()$$, '42501', NULL, 'authenticated cannot run the merge');
SELECT throws_ok($$SELECT * FROM public.ingest_job_batch(gen_random_uuid(), '[]')$$, '42501', NULL, 'authenticated cannot ingest');

RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO public.job_sources (id, provider_type, tenant_slug, display_name, base_endpoint_url, is_active)
VALUES ('5e777777-0000-4000-8000-000000000001', 'greenhouse', 'alpha-mq', 'Alpha', 'https://boards-api.greenhouse.io/v1/boards/alpha-mq/jobs', true);
SELECT results_eq($$SELECT inserted, merged, updated FROM public.ingest_job_batch('5e777777-0000-4000-8000-000000000001', '[
  {"external_id":"g1","employer_name":"Alpha","employer_slug":"alpha-mq","employer_domain":"alpha-mq.example","title":"Sales Development Representative",
   "title_slug":"sales-development-representative","locations":["Austin, us"],"workplace":"hybrid","employment":"full_time","description":"SDR role",
   "simhash":7,"posting_url":"https://a.example/g1","apply_url":"https://a.example/g1","raw_hash":"h1","country_codes":["US"]},
  {"external_id":"g2","employer_name":"Alpha","employer_slug":"alpha-mq","employer_domain":"alpha-mq.example","title":"Sales Development Representative",
   "title_slug":"sales-development-representative","locations":["London, gb"],"workplace":"hybrid","employment":"full_time","description":"SDR role",
   "simhash":7,"posting_url":"https://a.example/g2","apply_url":"https://a.example/g2","raw_hash":"h2","country_codes":["GB"]}]')$$,
  $$VALUES (1, 1, 0)$$, 'ingest inserts the first office and merges the second');
SELECT is((SELECT region || ':' || array_to_string(country_codes, ',') FROM public.canonical_jobs WHERE normalized_title_slug = 'sales-development-representative'),
  'us:GB,US', 'merged ingest keeps both countries; any US location makes it a US role');
SELECT results_eq($$SELECT inserted, merged, updated FROM public.ingest_job_batch('5e777777-0000-4000-8000-000000000001', '[
  {"external_id":"g1","employer_name":"Alpha","employer_slug":"alpha-mq","employer_domain":"alpha-mq.example","title":"Sales Development Representative",
   "title_slug":"sales-development-representative","locations":["Austin, us"],"workplace":"hybrid","employment":"full_time","description":"SDR role",
   "simhash":7,"posting_url":"https://a.example/g1","apply_url":"https://a.example/g1","raw_hash":"h1","country_codes":["US"]}]')$$,
  $$VALUES (0, 0, 1)$$, 'redelivered page only refreshes (idempotent)');

SELECT * FROM finish();
ROLLBACK;
