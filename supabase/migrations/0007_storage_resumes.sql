-- Private originals. Only user-session access; no service-role application path.
-- Object keys are {auth.uid()}/{resume_id}/source.pdf (or source.docx).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('resumes', 'resumes', false, 10485760,
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY resumes_read_own ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);
CREATE POLICY resumes_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);
CREATE POLICY resumes_update_own ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'resumes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'resumes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);
CREATE POLICY resumes_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'resumes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);
