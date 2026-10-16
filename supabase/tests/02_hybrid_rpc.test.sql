BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);
SELECT ok(NOT has_function_privilege('anon', 'public.match_jobs_hybrid(uuid,text,boolean,integer,integer,text,boolean,integer)', 'EXECUTE'), 'anon cannot execute hybrid RPC');
SELECT ok(has_function_privilege('authenticated', 'public.match_jobs_hybrid(uuid,text,boolean,integer,integer,text,boolean,integer)', 'EXECUTE'), 'authenticated can execute hybrid RPC');
SELECT ok(NOT prosecdef, 'hybrid RPC uses security invoker') FROM pg_proc WHERE oid = 'public.match_jobs_hybrid(uuid,text,boolean,integer,integer,text,boolean,integer)'::regprocedure;
INSERT INTO auth.users(id, email) VALUES ('11111111-1111-4111-8111-111111111111', 'rpc@jobr.test');
INSERT INTO public.users_profile(id, email) VALUES ('11111111-1111-4111-8111-111111111111', 'rpc@jobr.test') ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email; -- 0006 trigger may have created it
INSERT INTO public.candidate_profiles(id,user_id) VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
SELECT lives_ok($$ SELECT * FROM public.match_jobs_hybrid('33333333-3333-4333-8333-333333333333') $$, 'owned-profile query executes against migrated schema');
SELECT throws_ok($$ SELECT * FROM public.match_jobs_hybrid('22222222-2222-4222-8222-222222222222') $$, '42501', 'Candidate profile 22222222-2222-4222-8222-222222222222 not found or unauthorized', 'unauthorized profile fails closed');
SELECT throws_ok($$ SELECT * FROM public.match_jobs_hybrid('22222222-2222-4222-8222-222222222222', '', false, 0, 10) $$, '22023', 'Invalid hybrid query limits', 'rejects invalid RRF divisor');
SELECT throws_ok($$ SELECT * FROM public.match_jobs_hybrid('22222222-2222-4222-8222-222222222222', '', false, 60, 51) $$, '22023', 'Invalid hybrid query limits', 'caps result limit');
SELECT throws_ok($$ SELECT * FROM public.match_jobs_hybrid('22222222-2222-4222-8222-222222222222', '', false, 60, NULL) $$, '22023', 'Invalid hybrid query limits', 'rejects null result limit');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
