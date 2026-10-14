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
local stack only. `test:db` runs the same pgTAP suites against the running Supabase stack. The alternative
`test:db:local` uses a disposable vanilla PostgreSQL database and
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
Packet 2 adds the OpenAI resume-extraction call, tested with a mocked client; live-model behavior is not verified here. Jobr never submits applications.


## Packet 2

- `src/lib/resume/extract.ts` accepts resume text, calls the OpenAI SDK with
  `ResumeParseFormat`, drops ungrounded items using the existing exact `verifyQuote`,
  and computes inclusive non-overlapping calendar months. Set `OPENAI_API_KEY` on the
  server; `OPENAI_RESUME_MODEL` optionally selects a model. No key reaches the UI.
- `src/lib/http/safe_fetch.ts` is GET-only, pins validated public DNS addresses to the
  socket, rechecks every redirect (maximum three), strips headers cross-origin, and
  limits total time and response bytes. Token buckets are shared per host.
- `apps/ingest` is imported from PR #2 (`954c9d6`) as the canonical adapter base.
  Provider payloads normalize with Gemini's existing schemas. New `fetchJobs(tenant)`
  methods delegate into that layer; existing incremental adapter methods stay available
  for compatibility. USAJOBS requires `USAJOBS_API_KEY` and `USAJOBS_USER_AGENT_EMAIL`.
- `src/lib/ingestion/dedup.ts` implements Packet 2's tier/time-window rules. The prior
  SimHash deduplicator remains available for existing callers; the two rule versions
  must not be silently interchanged when transactional persistence is implemented.
- `/matches` is a server-rendered empty shell. No profile upload or application submission
  endpoint is added. Resume parsing operates on text; PDF/DOCX byte extraction is separate.

Locked decisions: Cloudflare Workers/Queues/Cron for background work; preparation only,
with optional submission performed by the user; free sources only, JobsPipe deferred;
Recruitee support ends after 2027-02-10 (no Recruitee adapter is enabled in this packet).
No matching LLM invocation is added before SQL hard filters; the score-locked explanation
format requires server-provided SQL eligibility. Resume parsing is profile construction,
not a job-ranking/explanation call.

The inherited Cloudflare board-probe entrypoint remains undeployed. Its runtime/deployment
and durable queue/persistence integration are not claimed as verified by Node unit tests.
The inherited offline ranking CLI contains a single-user sample profile and must not be
used as a multi-tenant API. No paid source or third-party job-board scraping is enabled.
