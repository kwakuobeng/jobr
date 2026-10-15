-- Minimal stand-in for the pieces of a Supabase database that 0001_initial_schema.sql
-- and the pgTAP tests depend on. Used ONLY for running pgTAP against vanilla Postgres
-- (scripts/run-pgtap-local.sh). Under `supabase start` these objects already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Hosted auth.users carries raw_user_meta_data; the 0006 signup trigger reads it.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Same semantics as Supabase's auth.uid(): read `sub` from the request JWT claims GUC.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Supabase grants broad default privileges on public to API roles; replicate so that the
-- migration's explicit REVOKEs are what actually lock tables down.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Hosted Supabase grants USAGE on the extensions schema to API roles (pgvector/PostGIS types
-- and operators live there); without it the hybrid RPC fails locally with 42501.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- Storage metadata stand-in ONLY for the disposable vanilla PostgreSQL harness.
-- Real Supabase supplies these tables and enforces upload MIME/size separately.
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, public BOOLEAN NOT NULL DEFAULT false,
  file_size_limit BIGINT, allowed_mime_types TEXT[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT NOT NULL, UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
