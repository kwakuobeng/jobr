BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();
SELECT is((SELECT public FROM storage.buckets WHERE id = 'resumes'), false, 'resume bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'resumes'), 10485760::bigint, 'bucket caps originals at 10 MiB');
SELECT is((SELECT cardinality(allowed_mime_types) FROM storage.buckets WHERE id = 'resumes'), 2, 'only PDF/DOCX MIME types enabled');

-- Metadata isolation under the actual storage table's RLS. The Storage HTTP
-- upload/download API and signed URLs additionally require the hosted smoke.
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('resumes', 'aaaaaaaa-0000-4000-8000-000000000001/resume-a/source.pdf'),
  ('resumes', 'bbbbbbbb-0000-4000-8000-000000000002/resume-b/source.docx');
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'resumes'), 0, 'anon cannot read resume metadata');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES ('resumes','aaaaaaaa-0000-4000-8000-000000000001/anon/source.pdf')$$, '42501', NULL, 'anon cannot upload resume metadata');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'resumes'), 1, 'user A sees only their own object');
SELECT lives_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES ('resumes','aaaaaaaa-0000-4000-8000-000000000001/new/source.pdf')$$, 'user A can create own object');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES ('resumes','bbbbbbbb-0000-4000-8000-000000000002/forged/source.pdf')$$, '42501', NULL, 'cannot upload to another user prefix');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES ('resumes','aaaaaaaa-0000-4000-8000-000000000001-lookalike/source.pdf')$$, '42501', NULL, 'prefix lookalike fails closed');
SELECT throws_ok($$UPDATE storage.objects SET name='bbbbbbbb-0000-4000-8000-000000000002/moved/source.pdf' WHERE name='aaaaaaaa-0000-4000-8000-000000000001/new/source.pdf'$$, '42501', NULL, 'cannot rename own object into another namespace');
WITH changed AS (UPDATE storage.objects SET name='aaaaaaaa-0000-4000-8000-000000000001/stolen/source.docx' WHERE name='bbbbbbbb-0000-4000-8000-000000000002/resume-b/source.docx' RETURNING 1)
SELECT is((SELECT count(*)::int FROM changed), 0, 'cannot update another user object');
WITH changed AS (DELETE FROM storage.objects WHERE name='bbbbbbbb-0000-4000-8000-000000000002/resume-b/source.docx' RETURNING 1)
SELECT is((SELECT count(*)::int FROM changed), 0, 'cannot delete another user object');
SELECT lives_ok($$DELETE FROM storage.objects WHERE name='aaaaaaaa-0000-4000-8000-000000000001/new/source.pdf'$$, 'can delete own object');

SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'resumes'), 1, 'user B sees only their own object');
SELECT is_empty($$SELECT name FROM storage.objects WHERE name='aaaaaaaa-0000-4000-8000-000000000001/resume-a/source.pdf'$$, 'user B cannot read user A object');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
