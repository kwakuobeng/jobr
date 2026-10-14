# 07 — Database schema (Postgres / Supabase, DDL-level spec)

This is a design spec, not a migration. Conventions: `uuid` PKs (`gen_random_uuid()`), `timestamptz`, and every user-owned table carries `user_id uuid not null references auth.users(id) on delete cascade`. Extensions: `vector` (pgvector), `pg_trgm`, `pg_cron`, `pgmq` [VF P6, P7, P9].

```sql
-- ===== Tenancy & profile =====
create table user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text, timezone text not null default 'America/Chicago',
  digest_hour smallint not null default 7 check (digest_hour between 0 and 23),
  digest_days smallint[] not null default '{1,2,3,4,5}',
  inbound_alias text unique not null,            -- u-<random>@in.<domain>
  created_at timestamptz not null default now()
);
create table user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  title_families text[] not null, seniority_min smallint, seniority_max smallint,
  locations jsonb not null default '[]',          -- [{label,lat,lng,radius_km}]
  remote_countries text[] not null default '{US}',
  workplace_types text[] not null default '{remote,hybrid,onsite}',
  min_base_usd integer, employment_types text[] not null default '{full_time}',
  reapply_cooldown_days smallint not null default 90,
  profile_embedding vector(1536), updated_at timestamptz not null default now()
);
create table user_documents (                      -- resumes; file in private Storage bucket
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('resume','cover_letter_base')),
  storage_path text not null, parsed_text text, is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index one_primary_resume on user_documents(user_id) where is_primary and kind='resume';

-- ===== Shared catalog (no user_id; read-only to clients) =====
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null, normalized_name text not null unique,
  domain text, is_staffing_agency boolean not null default false
);
create table company_aliases (alias_normalized text primary key, company_id uuid not null references companies(id));
create table sources (                             -- one row per source TYPE
  id text primary key,                             -- 'greenhouse','lever','ashby','smartrecruiters','usajobs','email','url_jsonld'
  enabled boolean not null default true,
  terms_url text, terms_reviewed_at date, terms_notes text,
  rate_limit_rps numeric not null default 1
);
create table company_boards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  source_id text not null references sources(id),
  board_token text not null, region text not null default 'global',  -- lever EU etc.
  status text not null default 'active' check (status in ('active','invalid','blocked','paused')),
  consecutive_failures smallint not null default 0, last_success_at timestamptz,
  unique (source_id, board_token, region)
);
create table source_runs (
  id bigserial primary key, board_id uuid references company_boards(id),
  source_id text not null references sources(id), started_at timestamptz not null default now(),
  finished_at timestamptz, status text not null check (status in ('running','ok','partial','failed','blocked')),
  http_status smallint, jobs_seen int, jobs_new int, jobs_closed int, error text
);
create index on source_runs (board_id, started_at desc);

create table jobs (                                -- canonical job
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  title text not null, title_normalized text not null, title_family text,
  seniority smallint, employment_type text, workplace_type text,
  locations jsonb not null default '[]', remote_countries text[],
  pay_min numeric, pay_max numeric, pay_currency char(3), pay_interval text,
  description_html text, description_text text, requirements jsonb,
  apply_url text not null, canonical_url text not null,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  posted_at timestamptz, valid_through timestamptz, closed_at timestamptz,
  status text not null default 'open' check (status in ('open','closed','unlisted')),
  dedupe_key text not null,                        -- company_id|title_normalized|primary_location_key
  content_hash text not null,
  fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')),'A') ||
    setweight(to_tsvector('english', coalesce(description_text,'')),'C')) stored
);
create index jobs_open_company on jobs(company_id) where status='open';
create index jobs_fts on jobs using gin(fts);
create index jobs_dedupe on jobs(dedupe_key) where status='open';
create index jobs_title_trgm on jobs using gin(title_normalized gin_trgm_ops);

create table job_sources (                         -- many sources -> one canonical job
  source_id text not null references sources(id), board_id uuid references company_boards(id),
  external_id text not null, job_id uuid not null references jobs(id) on delete cascade,
  source_url text not null, missing_runs smallint not null default 0,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  primary key (source_id, board_id, external_id)
);
create table job_source_snapshots (                -- raw payloads, 30-day TTL
  id bigserial primary key, source_id text not null, external_id text not null,
  fetched_at timestamptz not null default now(), payload jsonb not null
);
create table job_embeddings (
  job_id uuid primary key references jobs(id) on delete cascade,
  model text not null default 'text-embedding-3-small', embedding vector(1536) not null,
  content_hash text not null
);

-- ===== Per-user matching =====
create table exclusion_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('company','do_not_reapply','keyword','title','staffing')),
  company_id uuid references companies(id), pattern text, reason text,
  created_at timestamptz not null default now(),
  check ((kind in ('company','do_not_reapply') and company_id is not null) or (kind not in ('company','do_not_reapply') and pattern is not null))
);
create unique index on exclusion_rules(user_id, kind, company_id) where company_id is not null;
create table matches (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  run_date date not null, score numeric(5,2) not null check (score between 0 and 100),
  components jsonb not null, explanation jsonb, model_version text not null,
  primary key (user_id, job_id, run_date)
);
create index on matches(user_id, run_date desc, score desc);
create table match_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references jobs(id), signal text not null check (signal in ('up','down','shortlist','hide')),
  reason text, created_at timestamptz not null default now()
);

-- ===== Applications (state machine in file 08) =====
create type app_state as enum ('shortlisted','preparing','prepared','authorized','submitted_unverified',
  'submitted_confirmed','interviewing','offer','rejected','withdrawn','ghosted','expired','abandoned');
create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references jobs(id),                 -- null for imported legacy rows
  company_id uuid not null references companies(id),
  title_family text, role_title text not null,
  state app_state not null default 'shortlisted',
  source_label text, imported_from text,           -- 'google_sheet' for tracker import
  submitted_at timestamptz, confirmed_at timestamptz, last_event_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- UNIQUENESS: no duplicate application to the same job
create unique index uniq_app_user_job on applications(user_id, job_id) where job_id is not null;
-- No second active/submitted application for same company + title family (covers reposts & multi-source)
create unique index uniq_app_user_company_family_active on applications(user_id, company_id, title_family)
  where state in ('preparing','prepared','authorized','submitted_unverified','submitted_confirmed','interviewing','offer');
-- Cooldown across closed states enforced by trigger: reject insert if same (user, company, title_family)
-- has submitted_at within user_preferences.reapply_cooldown_days, or company in do_not_reapply.

create table application_packages (               -- what "prepare" produced
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version int not null, content jsonb not null,    -- answers, cover letter, resume doc id
  package_hash text not null,                      -- sha256 of canonical content
  created_at timestamptz not null default now(), unique (application_id, version)
);
create table submission_authorizations (          -- explicit human authorization, single use
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  package_id uuid not null references application_packages(id),
  package_hash text not null, authorized_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  consumed_at timestamptz, user_agent text, ip inet
);
create unique index one_live_auth_per_app on submission_authorizations(application_id) where consumed_at is null;
create table application_events (                 -- append-only audit of state changes
  id bigserial primary key, application_id uuid not null references applications(id) on delete cascade,
  user_id uuid not null, from_state app_state, to_state app_state not null,
  actor text not null check (actor in ('user','system','email_parser')),
  evidence jsonb, created_at timestamptz not null default now()
);

-- ===== Inbound email & digests =====
create table inbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  received_at timestamptz not null default now(), from_addr text, subject text,
  classification text check (classification in ('job_alert','ats_confirmation','rejection','interview','other')),
  parsed jsonb, raw_r2_key text                     -- raw MIME kept 30 days
);
create table digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_date date not null, status text not null check (status in ('built','sent','failed','skipped_empty')),
  provider_message_id text, sent_at timestamptz, unique (user_id, run_date)
);
create table digest_items (
  digest_id uuid not null references digests(id) on delete cascade, job_id uuid not null references jobs(id),
  rank smallint not null, score numeric(5,2) not null, primary key (digest_id, job_id)
);
```

## RLS
```sql
-- Pattern applied to every table with user_id:
alter table applications enable row level security;
create policy own_rows_select on applications for select to authenticated using (user_id = (select auth.uid()));
create policy own_rows_write  on applications for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_rows_update on applications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy on application_events / submission_authorizations (append-only for users).
-- Shared catalog: companies, jobs, job_sources, job_embeddings -> SELECT to authenticated; no client writes.
-- sources, company_boards, source_runs, job_source_snapshots -> no client access (service role only).
-- State transitions to 'authorized'/'submitted_*' only via SECURITY DEFINER RPCs that validate the state machine
-- and the authorization row; direct UPDATE of applications.state is revoked from authenticated.
```
[EI] Index every `user_id` column used in policies. Wrap `auth.uid()` in a sub-select so it is evaluated once per statement (Supabase RLS performance guidance; exact doc not fetched → AV).

## Retention policy
| Data | Retention | Mechanism |
|---|---|---|
| `job_source_snapshots` (raw payloads) | 30 days | pg_cron daily delete |
| Inbound raw MIME (R2) | 30 days. Parsed fields stay with the user record | R2 lifecycle rule [AV] |
| Closed jobs | Full text 180 days after `closed_at`. Then null the description and keep a stub (title, company, URLs) while any application references it | pg_cron |
| `matches` | Top 50 per run, kept 30 days. `digest_items` kept 1 year | pg_cron |
| `source_runs` | 90 days (aggregated daily stats kept) | pg_cron |
| Applications, events, authorizations | Lifetime of the account (user-visible history). Authorizations are audit evidence | — |
| Account deletion | Soft-delete immediately (sign-out, digests stop). Hard delete of all user rows and Storage objects within 30 days | Scheduled job + `on delete cascade` |
Legal retention for authorization audit trails after account deletion: UNCONFIRMED. Get a privacy/legal read before external users [AV].
