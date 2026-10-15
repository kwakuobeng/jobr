# Jobr

Evidence-grounded job discovery and application copilot.

## M1.1 foundation

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

`test:unit` runs the deterministic unit, mocked adapter integration, and security suites,
and enforces ≥90% statements, branches, functions, and lines on `src/lib/resume` and
`src/lib/ingestion`. `test:integration` and `test:security` run those suites individually.
`test:coverage` runs all deterministic suites; live-board tests are opt-in.

```sh
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
pnpm exec supabase start
pnpm test:db:supabase
JOBR_LIVE=1 pnpm test:live
```

`test:db:supabase` executes `supabase db reset --local && supabase test db` against the
local stack only. Existing `test:db` uses a disposable vanilla PostgreSQL database and
`scripts/local_supabase_stub.sql`; it requires pgTAP, pgvector and PostGIS and is a separate
compatibility harness, not proof of a working Supabase stack. Do not run it against a
production database.

Copy `.env.example` to `.env.local` for future service credentials. Never commit secrets.
USAJOBS receives its API key and email user agent through server-side adapter configuration;
no live USAJOBS credential is bundled. The five-board live suite uses public ATS APIs.

## Module contracts

- `specs/ai/structured_schemas.ts`: strict Responses API formats, randomized escaped XML
  boundaries, tools disabled, exact system prompts, and immutable deterministic score input.
- `src/lib/resume`: calendar-validated month merging, exact quotes with contiguous line IDs,
  runtime grounding gates, and unanswered/unverified factual question fallback to user input.
- `src/lib/ingestion`: HTTPS/socket DNS guards, bounded requests without redirects, rate
  limiting, Greenhouse/Ashby/Lever/USAJOBS/JSON-LD adapters, authoritative membership checks,
  and pure four-tier deduplication decisions. Persistence must apply those decisions in a
  transaction and retain source uniqueness; this milestone does not run an ingestion worker.
- `specs/api/contracts.ts` and `specs/ui/component_architecture.md`: later API and UI contracts.
- `components.json` and `src/components/ui/button.tsx`: shadcn-compatible component foundation.

Adapters accept `{ tenant, employerName, employerDomain? }` for public ATS boards,
`{ apiKey, userAgent, keyword?, page? }` for USAJOBS and `{ url }` for JSON-LD pages.
Full-board ETags represent a conditional snapshot, not timestamp-based deltas. USAJOBS
returns page cursors; page absence must never be interpreted as proof a listing is closed.
HTTP 429/5xx and redirects are inconclusive; callers retry rather than close listings.

The supplied fixtures are synthetic examples, not recorded live captures. The employer
registry is supplied input and must be revalidated before scheduled ingestion.

## Database migrations

- `0001_initial_schema.sql`: core schema; PostGIS installs into the unexposed `extensions` schema and geography types are schema-qualified.
- `0002_rls_ownership_and_postgis_hardening.sql`: linked-row ownership policies and a fail-closed check against public PostGIS catalog exposure.
- `0004_hybrid_search_rpc.sql`: supplied hybrid RPC, renumbered to preserve hardening and
  reserve `0003` for future storage policies. Adds bounded parameters, ordered candidate
  limits and revokes default PUBLIC execution. It remains SECURITY INVOKER.
- `01_rls_isolation.test.sql`: existing extensive isolation suite, retained in place.
- `02_hybrid_rpc.test.sql`: execution grants, unauthorized ownership, limits and owned-profile
  query tests. Database results must be verified in a real local stack.

The blueprint calls for PostgreSQL 16. The installed Supabase CLI rejects
`db.major_version = 16`, so the existing supported local value `17` remains. This is an
explicit acceptance gap: PostgreSQL 16 compatibility has not been verified.
See [Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config).

## Verification limits

See `specs/m1_1_verification.md` for commands, results and open gates. XML boundary escaping,
closed schemas, tool isolation and deterministic validation are defense layers; they do not
prove a model cannot hallucinate. Valid citation text does not prove that a paraphrase is
entailed by it. Human review is required before authorizing factual answers or submission.
No live model execution or automatic application submission is implemented in M1.1.

## Cloudflare Workers

Use Node 24 and pnpm 11.25.0. Install with `pnpm install --frozen-lockfile`.
`pnpm build` builds Next.js; `pnpm exec opennextjs-cloudflare build` produces
`.open-next/worker.js` and assets for the `jobr` Worker with `nodejs_compat`.

- `pnpm preview`: build and run the Worker locally through Wrangler.
- `pnpm deploy`: build and deploy to Cloudflare (requires Cloudflare account access).
- `pnpm cf-typegen`: regenerate ignored `cloudflare-env.d.ts` bindings.

The placeholder home page remains at `/`; `GET /api/health` returns `{"ok":true}`.
Use that endpoint to check the local preview after startup. No ATS submission or
paid data source is added. Supabase integration remains future work; the public
variable names are documented in `.env.example`. Supply actual values through
local environment configuration or deployment settings, never committed files.

## Auth (M1)

Email and password are the primary flow at `/sign-up` and `/sign-in`.
Copy `.env.example` to ignored `.env.local` and supply the public Supabase URL
and anon key. Only public Supabase configuration is used by this auth layer.
The signup metadata includes optional `full_name`; migration 0006's existing
trigger creates `users_profile`. No app-level elevated insert is used.

Set Supabase Auth Site URL to `https://jobr.kwakubobeng.workers.dev` and allow
`https://jobr.kwakubobeng.workers.dev/auth/callback` plus the callback on your
local development origin. Confirmation uses PKCE, so open the email link in
the same browser that initiated signup. `/auth/callback` exchanges the code
and restores the safe local destination. Protected routes use verified users,
not unverified session payloads; middleware forwards refreshed cookies to both
the request and response, including auth redirects. Keep authenticated responses
uncached on Workers. Sign out is a Server Action (POST with Next's origin check).
Configure the public build variables before building/deploying to Workers.
For cloud machines with an installed Chromium, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` to run the same Playwright
smokes without downloading another browser; CI uses Playwright's default binary.
