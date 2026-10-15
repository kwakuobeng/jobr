-- pgTAP: behavioral Stage 1 / Stage 2 checks for public.match_jobs_hybrid (0004 + 0005).
-- Ported from Gemini Packet #1 (02_hybrid_rpc.test.sql) onto main's signature
-- match_jobs_hybrid(uuid, text, boolean, integer, integer); fixtures adapted.
BEGIN;
SELECT plan(16);

-- Isolation: hide any pre-existing jobs (e.g. hosted QA/prototype rows) for the life of this
-- transaction; Stage 1 only admits status = 'active'. Rolled back with the test.
UPDATE public.canonical_jobs SET status = 'closed' WHERE status = 'active';

-- 1. Seed two authenticated users in auth.users
INSERT INTO auth.users (id, email)
VALUES
  ('a1111111-1111-1111-1111-111111111111', 'alice@jobr.test'),
  ('b2222222-2222-2222-2222-222222222222', 'bob@jobr.test');

INSERT INTO public.users_profile (id, email, full_name)
VALUES
  ('a1111111-1111-1111-1111-111111111111', 'alice@jobr.test', 'Alice Engineer'),
  ('b2222222-2222-2222-2222-222222222222', 'bob@jobr.test', 'Bob Engineer')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name; -- 0006 trigger may have created it

-- 2. Seed Alice's candidate profile and hard preferences
INSERT INTO public.candidate_profiles (
  id, user_id, profile_name, is_default, total_experience_months, target_job_embedding
)
VALUES (
  'c1111111-1111-1111-1111-111111111111',
  'a1111111-1111-1111-1111-111111111111',
  'Primary Distributed Systems Profile',
  true,
  72,
  array_fill(0.02::real, ARRAY[1536])::vector(1536)
);

-- 3. Seed three employers (Allowed Corp, Excluded Corp, Allowed Corp 2)
INSERT INTO public.canonical_employers (id, canonical_name, normalized_slug, primary_domain)
VALUES
  ('e1111111-1111-1111-1111-111111111111', 'Stripe', 'stripe', 'stripe.com'),
  ('e2222222-2222-2222-2222-222222222222', 'BlockedCorp', 'blockedcorp', 'blocked.example.com'),
  ('e3333333-3333-3333-3333-333333333333', 'Linear', 'linear', 'linear.app');

INSERT INTO public.job_preferences (
  user_id,
  candidate_profile_id,
  excluded_employer_ids,
  excluded_employer_domains,
  allowed_workplace_types,
  allowed_employment_types,
  hard_min_annual_salary_usd,
  allow_undisclosed_salary,
  excluded_tech_slugs,
  requires_visa_sponsorship
)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'c1111111-1111-1111-1111-111111111111',
  ARRAY['e2222222-2222-2222-2222-222222222222'::uuid],
  ARRAY['blocked.example.com'],
  ARRAY['remote', 'hybrid']::public.workplace_mode_type[],
  ARRAY['full_time']::public.employment_commitment_type[],
  180000,
  true,
  ARRAY['cobol'],
  true
);

-- j9 uses a same-direction embedding as j1 (cosine tie), so it ranks 2nd; j1 wins on lexical.
-- 4. Seed canonical jobs testing every Stage 1 filter + Stage 2 RRF ordering:
-- Job 1 (j1): Best match (high vector similarity + exact lexical match "distributed systems kubernetes")
-- Job 2 (j2): Secondary match (active, passes all hard filters, lower lexical match)
-- Job 3 (j3): Excluded employer (e2222222) -> MUST BE FILTERED OUT
-- Job 4 (j4): Inactive status ('closed') -> MUST BE FILTERED OUT
-- Job 5 (j5): Rejected identity_hash ('hash_rejected_role') -> MUST BE FILTERED OUT
-- Job 6 (j6): Below hard min salary ($140k < $180k) -> MUST BE FILTERED OUT
-- Job 7 (j7): Excluded tech slug ('cobol') -> MUST BE FILTERED OUT
INSERT INTO public.canonical_jobs (
  id, canonical_employer_id, identity_hash, description_simhash,
  title, normalized_title_slug, employer_name, workplace_type, employment_type,
  min_annual_salary_usd, max_annual_salary_usd, extracted_tech_slugs,
  visa_sponsorship_policy, description_plain, requirements_summary_text,
  canonical_posting_url, application_url, status, requirements_embedding
)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'e1111111-1111-1111-1111-111111111111',
    'hash_valid_top_match',
    1001,
    'Staff Distributed Systems Engineer',
    'staff-distributed-systems-engineer',
    'Stripe',
    'remote',
    'full_time',
    195000,
    235000,
    ARRAY['go', 'kubernetes', 'postgresql'],
    'offered',
    'Architect distributed systems and Kubernetes storage clusters in Go.',
    'Distributed systems Kubernetes Go PostgreSQL',
    'https://boards.greenhouse.io/stripe/jobs/101',
    'https://boards.greenhouse.io/stripe/jobs/101',
    'active',
    array_fill(0.02::real, ARRAY[1536])::vector(1536)
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'e3333333-3333-3333-3333-333333333333',
    'hash_valid_second_match',
    1002,
    'Senior Backend Infrastructure Engineer',
    'senior-backend-infrastructure-engineer',
    'Linear',
    'hybrid',
    'full_time',
    185000,
    210000,
    ARRAY['typescript', 'postgresql'],
    'unknown',
    'Scale real-time sync infrastructure and database replication.',
    'Backend sync infrastructure',
    'https://jobs.ashbyhq.com/linear/102',
    'https://jobs.ashbyhq.com/linear/102/apply',
    'active',
    (
      ARRAY[0.05::real, -0.02::real] ||
      array_fill(0.02::real, ARRAY[1534])
    )::vector(1536)
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    'e2222222-2222-2222-2222-222222222222',
    'hash_excluded_employer',
    1003,
    'Staff Distributed Systems Engineer',
    'staff-distributed-systems-engineer',
    'BlockedCorp',
    'remote',
    'full_time',
    220000,
    260000,
    ARRAY['go', 'kubernetes'],
    'offered',
    'Distributed systems Kubernetes Go role at an excluded employer.',
    'Distributed systems Kubernetes Go',
    'https://boards.greenhouse.io/blockedcorp/jobs/103',
    'https://boards.greenhouse.io/blockedcorp/jobs/103',
    'active',
    array_fill(0.02::real, ARRAY[1536])::vector(1536)
  ),
  (
    '10000000-0000-0000-0000-000000000004',
    'e1111111-1111-1111-1111-111111111111',
    'hash_closed_job',
    1004,
    'Staff Distributed Systems Engineer (Closed)',
    'staff-distributed-systems-engineer-closed',
    'Stripe',
    'remote',
    'full_time',
    210000,
    250000,
    ARRAY['go', 'kubernetes'],
    'offered',
    'Distributed systems Kubernetes Go role that is closed.',
    'Distributed systems Kubernetes Go',
    'https://boards.greenhouse.io/stripe/jobs/104',
    'https://boards.greenhouse.io/stripe/jobs/104',
    'closed',
    array_fill(0.02::real, ARRAY[1536])::vector(1536)
  ),
  (
    '10000000-0000-0000-0000-000000000005',
    'e1111111-1111-1111-1111-111111111111',
    'hash_rejected_role',
    1005,
    'Staff Distributed Systems Engineer (Rejected)',
    'staff-distributed-systems-engineer-rejected',
    'Stripe',
    'remote',
    'full_time',
    210000,
    250000,
    ARRAY['go', 'kubernetes'],
    'offered',
    'Distributed systems Kubernetes Go role already rejected by Alice.',
    'Distributed systems Kubernetes Go',
    'https://boards.greenhouse.io/stripe/jobs/105',
    'https://boards.greenhouse.io/stripe/jobs/105',
    'active',
    array_fill(0.02::real, ARRAY[1536])::vector(1536)
  ),
  (
    '10000000-0000-0000-0000-000000000006',
    'e1111111-1111-1111-1111-111111111111',
    'hash_low_salary_role',
    1006,
    'Distributed Systems Engineer (Low Salary)',
    'distributed-systems-engineer-low-salary',
    'Stripe',
    'remote',
    'full_time',
    120000,
    140000,
    ARRAY['go', 'kubernetes'],
    'offered',
    'Distributed systems Kubernetes Go role below hard salary minimum.',
    'Distributed systems Kubernetes Go',
    'https://boards.greenhouse.io/stripe/jobs/106',
    'https://boards.greenhouse.io/stripe/jobs/106',
    'active',
    array_fill(0.02::real, ARRAY[1536])::vector(1536)
  ),
  (
    '10000000-0000-0000-0000-000000000007',
    'e1111111-1111-1111-1111-111111111111',
    'hash_excluded_tech_role',
    1007,
    'Distributed Systems Mainframe Engineer',
    'distributed-systems-mainframe-engineer',
    'Stripe',
    'remote',
    'full_time',
    200000,
    240000,
    ARRAY['go', 'cobol'],
    'offered',
    'Distributed systems Kubernetes Go and COBOL role.',
    'Distributed systems Kubernetes Go COBOL',
    'https://boards.greenhouse.io/stripe/jobs/107',
    'https://boards.greenhouse.io/stripe/jobs/107',
    'active',
    array_fill(0.02::real, ARRAY[1536])::vector(1536)
  );

-- Record a prior rejection by Alice for 'hash_rejected_role'
INSERT INTO public.match_evaluations (
  id, user_id, candidate_profile_id, canonical_job_id, identity_hash,
  passed_hard_filters, overall_score, skill_score, semantic_score,
  experience_score, seniority_score, compensation_score, location_score,
  trajectory_score, recommendation_tier
)
VALUES (
  'f1111111-1111-1111-1111-111111111111',
  'a1111111-1111-1111-1111-111111111111',
  'c1111111-1111-1111-1111-111111111111',
  '10000000-0000-0000-0000-000000000005',
  'hash_rejected_role',
  true, 85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 'strong_match'
);

INSERT INTO public.recommendation_decisions (
  user_id, candidate_profile_id, canonical_job_id, match_evaluation_id,
  identity_hash, decision, rejection_reason_code
)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'c1111111-1111-1111-1111-111111111111',
  '10000000-0000-0000-0000-000000000005',
  'f1111111-1111-1111-1111-111111111111',
  'hash_rejected_role',
  'rejected',
  'company_unappealing'
);


INSERT INTO public.canonical_jobs (
  id, canonical_employer_id, identity_hash, description_simhash,
  title, normalized_title_slug, employer_name, workplace_type, employment_type,
  min_annual_salary_usd, max_annual_salary_usd, extracted_tech_slugs,
  visa_sponsorship_policy, description_plain, requirements_summary_text,
  canonical_posting_url, application_url, status, requirements_embedding
)
VALUES
  ('10000000-0000-0000-0000-000000000008','e1111111-1111-1111-1111-111111111111','hash_domain_host',1008,
   'Platform Engineer','platform-engineer','Stripe','remote','full_time',200000,240000,ARRAY['go'],'offered',
   'Platform role hosted on an excluded domain.','Platform','https://careers.blocked.example.com/jobs/108',
   'https://careers.blocked.example.com/jobs/108','active',array_fill(0.02::real, ARRAY[1536])::vector(1536)),
  ('10000000-0000-0000-0000-000000000009','e3333333-3333-3333-3333-333333333333','hash_lookalike_host',1009,
   'Platform Engineer','platform-engineer','Linear','remote','full_time',200000,240000,ARRAY['go'],'offered',
   'Platform role on a lookalike host that must NOT be excluded.','Platform','https://notblocked-example.com/jobs/109',
   'https://notblocked-example.com/jobs/109','active',array_fill(0.01::real, ARRAY[1536])::vector(1536)),
  ('10000000-0000-0000-0000-000000000010','e3333333-3333-3333-3333-333333333333','hash_min_only_low',1010,
   'Platform Engineer','platform-engineer','Linear','remote','full_time',150000,NULL,ARRAY['go'],'offered',
   'Min-only salary below the floor.','Platform','https://jobs.ashbyhq.com/linear/110',
   'https://jobs.ashbyhq.com/linear/110','active',array_fill(0.02::real, ARRAY[1536])::vector(1536));


SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'match_jobs_hybrid' AND pronamespace = 'public'::regnamespace), 1, 'exactly one match_jobs_hybrid overload exists');
SELECT ok(NOT has_function_privilege('public', 'public.match_jobs_hybrid(uuid,text,boolean,integer,integer)', 'EXECUTE'), 'PUBLIC holds no EXECUTE on hybrid RPC');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes')$$, '42501', NULL, 'anon call throws 42501');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true);
SELECT throws_ok($$SELECT * FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes')$$, '42501', NULL, 'authenticated role without a JWT sub fails closed with 42501');

SELECT set_config('request.jwt.claims', '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes')$$, '42501', NULL, 'User B on User A profile throws 42501');

SELECT set_config('request.jwt.claims', '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes') WHERE canonical_job_id = '10000000-0000-0000-0000-000000000003'$$, 'Excluded employer id (j3) is filtered in Stage 1');
SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes') WHERE canonical_job_id = '10000000-0000-0000-0000-000000000004'$$, 'Closed job (j4) is filtered in Stage 1');
SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes') WHERE identity_hash = 'hash_rejected_role'$$, 'Rejected identity_hash (j5) is suppressed');
SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes') WHERE canonical_job_id = '10000000-0000-0000-0000-000000000006'$$, 'Below-floor salary job (j6) is filtered');
SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes') WHERE canonical_job_id = '10000000-0000-0000-0000-000000000007'$$, 'Excluded tech slug job (j7) is filtered');
SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes') WHERE canonical_job_id = '10000000-0000-0000-0000-000000000008'$$, 'Posting host on excluded domain (j8) is filtered');
SELECT is_empty($$SELECT 1 FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes') WHERE canonical_job_id = '10000000-0000-0000-0000-000000000010'$$, 'Min-only salary below floor (j10) is filtered, not treated as undisclosed');
SELECT isnt_empty($$SELECT 1 FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes') WHERE canonical_job_id = '10000000-0000-0000-0000-000000000009'$$, 'Lookalike host (j9) is NOT over-excluded');
SELECT results_eq(
  $$SELECT canonical_job_id FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes')$$,
  ARRAY['10000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000009'::uuid, '10000000-0000-0000-0000-000000000002'::uuid],
  'only eligible jobs are returned, in deterministic fused-RRF order');
SELECT ok((SELECT (array_agg(rrf_score ORDER BY rrf_score DESC))[1] > (array_agg(rrf_score ORDER BY rrf_score DESC))[2] FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes')), 'rank 1 has strictly higher RRF score than rank 2');
SELECT results_eq(
  $$SELECT canonical_job_id FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes')$$,
  $$SELECT canonical_job_id FROM public.match_jobs_hybrid('c1111111-1111-1111-1111-111111111111'::uuid, 'distributed systems kubernetes')$$,
  'repeated calls return identical ordering');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
