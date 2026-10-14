# Jobr

Job discovery & application copilot.

## M1.1 foundation

- `pnpm install`
- `pnpm typecheck` / `pnpm lint` / `pnpm test:unit`
- `pnpm test:db` — runs `supabase/tests/*.sql` with `pg_prove` against a throwaway local Postgres
  (needs pgtap, pgvector, postgis; uses `scripts/local_supabase_stub.sql` to emulate Supabase's
  `auth` schema and `anon`/`authenticated` roles; applies all `supabase/migrations/*.sql` in order). With the Supabase CLI: `supabase db reset && supabase test db`.

Copy `.env.example` to `.env.local` and fill in values. Never commit secrets.

### Migrations

- `0001_initial_schema.sql`: core schema + RLS (verbatim from blueprint).
- `0002_rls_ownership_and_postgis_hardening.sql`: parent-ownership checks on child INSERT/UPDATE policies; locks down PostGIS `spatial_ref_sys`.
  Blueprint migrations planned as 0002/0003 (storage RLS T-103, hybrid RPC T-401) should be renumbered to 0003+.

# Jobr

AI job-matching SaaS. Jobr matches candidates to roles from public ATS feeds, USAJOBS, forwarded job alerts and pasted URLs; the user approves and submits every application.

**Status:** planning. No application code yet.

- Blueprint: [`docs/JOBR-BLUEPRINT.md`](docs/JOBR-BLUEPRINT.md)
- Decisions and open items: [`docs/16-unverified-items.md`](docs/16-unverified-items.md)

Planned stack: Next.js (Vercel), Supabase, Cloudflare Workers, OpenAI embeddings, Resend.
