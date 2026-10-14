# Jobr

Job discovery & application copilot.

## M1.1 foundation

- `pnpm install`
- `pnpm typecheck` / `pnpm lint` / `pnpm test:unit`
- `pnpm test:db` — runs `supabase/tests/*.sql` with `pg_prove` against a throwaway local Postgres
  (needs pgtap, pgvector, postgis; uses `scripts/local_supabase_stub.sql` to emulate Supabase's
  `auth` schema and `anon`/`authenticated` roles). With the Supabase CLI: `supabase db reset && supabase test db`.

Copy `.env.example` to `.env.local` and fill in values. Never commit secrets.
