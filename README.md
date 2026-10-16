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

Copy `.env.example` to `.env.local` for local service configuration. Never commit secrets.
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
  transaction and retain source uniqueness. The hourly Worker is documented in `apps/ingest/README.md`.
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
Resume extraction optionally calls the configured AI provider; live grounding still requires verification. Automatic application submission is not implemented.

## Cloudflare Workers

Use Node 24 and pnpm 11.25.0. Install with `pnpm install --frozen-lockfile`.
`pnpm build` builds Next.js; `pnpm exec opennextjs-cloudflare build` produces
`.open-next/worker.js` and assets for the `jobr` Worker with `nodejs_compat`.

- `pnpm preview`: build and run the Worker locally through Wrangler.
- `pnpm deploy`: build and deploy to Cloudflare (requires Cloudflare account access).
- `pnpm cf-typegen`: regenerate ignored `cloudflare-env.d.ts` bindings.

The placeholder home page remains at `/`; `GET /api/health` returns `{"ok":true}`.
Use that endpoint to check the local preview after startup. No ATS submission or
paid data source is added. Auth, resume storage and matches use Supabase; the public
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

## Preferences and matches (M1)

After signing in, open `/preferences`, save the hard filters, then open `/matches`.
The first request creates a default candidate profile only when none exists and
inserts missing preferences using schema defaults. Inserts ignore conflicts and
never overwrite saved preferences; all reads and writes use the user's session
and existing RLS. The signup trigger remains responsible for `users_profile`.
The UI reuses the shared request contracts and additionally respects PostgreSQL's
whole-mile commute range (0–500) and integer salary range. Commute limits need an
existing home location; this form does not collect one.

Matches call the real `match_jobs_hybrid` RPC with RRF k=60 and at most 50 results.
There is no stub mode or fabricated data. No eligible rows produces an explicit
empty state. Stretch exceptions are opt-in and visibly labeled as relaxing hard
filters. External source/application links open a new tab; Jobr never submits.
`GET /api/preferences`, `PUT /api/preferences` and `POST /api/matches` require a
verified user; writes require the same Origin as the request URL. Errors use the
shared API error schema. Authenticated responses are private/no-store.

## Resume and workplace UI

`/resume` accepts text-based PDF/DOCX files up to 10 MiB (PDF: at most 50
pages). Originals go to the private `resumes` Storage bucket at
`{auth.uid()}/{resume_id}/source.pdf` or `source.docx`. The original filename is
metadata, never part of the object key. Uploads, metadata, chip edits and approval
use the cookie session and existing table RLS; no privileged client is used.

Parsing runs locally in the upload request: unpdf's serverless PDF.js build for
PDF text, fflate plus XML parsing for DOCX. Extraction caps PDF pages, text length
and DOCX document XML size, rejects DTD/entity definitions, and does not render
images or perform OCR. No OpenAI/XAI key is required or read, and resume text is
not sent to a model. Only the public Supabase URL/key used by auth are required.
Bounded multipart reads enforce the size limit even without Content-Length.
Private Storage must exist; upload fails with a migration-specific error if it
is unavailable. Original files are retained privately, including failed parses.
An interrupted request can be retried by uploading the file again.

Detected skills are validated through the existing evidence-grounded resume
validator. Suggested title lines and explicitly stated years are heuristic and
require review; dated employment history is not invented. Raw text and line IDs
are stored on `resumes`; extraction provenance and editable chips are kept in
`resume_versions.normalized_profile_json`. Editing chips preserves the original
extraction. **Use for matching** saves `resume_versions.is_user_approved` on the
shown version. Matching consumes approved chips for lexical retrieval and, on Workers with an AI
binding, a hash-gated profile embedding. Suggested skills require acceptance before
joining the explicit chips.

Workplace badges map stored values to Remote / Onsite / Hybrid / Unknown.
Stored locations are displayed when useful; there is no scraping, inference,
backfill, or write to canonical jobs. Scores are under Match details.

### Resume storage deployment (migration 0007)

1. Merge the PR, then apply `supabase/migrations/0007_storage_resumes.sql` to
   hosted project `nwnhsqayjfwxfuthkymw` using the project's existing migration
   workflow (for a correctly linked CLI with migration history in sync:
   `pnpm exec supabase db push`). Do not replay or edit migrations 0001–0006.
2. The SQL creates/configures the private bucket and four user-prefix policies;
   no separate bucket creation is needed. In Supabase Dashboard → Storage →
   `resumes`, verify Private, 10 MiB limit, and PDF/DOCX MIME restrictions.
3. With existing public Supabase build variables set, run `pnpm deploy`.
4. Sign in → Matches: verify badges and details disclosure at mobile width.
   Resume: upload PDF and DOCX → Ready → add/remove a chip → save → reload →
   verify persisted chips and approval. Preferences and Sign out must still work.
5. In a second browser signed in as another user, attempt an authenticated
   download of the first user's exact Storage path. It must fail; public object
   URLs must also fail. Verify this through the Storage API, not only table SQL.

Tests include real PDF/DOCX extraction, bounded request reads, mocked upload/edit
and failure flows, anonymous redirects, and cross-user Storage metadata pgTAP.
The vanilla PostgreSQL harness uses a minimal Storage metadata stand-in and
cannot prove Storage HTTP behavior; CI runs the same policies on real Supabase.
The hosted checks above remain required after migration and deployment.

## Production readiness

See [the current readiness runbook](specs/production_readiness.md) for migration
0009, backfill, Workers AI, queues, smoke checks and remaining live gates. Older
milestone sections above describe their original scope; a green health response
does not establish the deployed commit or database migration state.
