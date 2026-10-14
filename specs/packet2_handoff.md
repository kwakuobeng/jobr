# Packet 2 implementation handoff

Base: `feat/m1-1-foundation`, commit `1794edb128d6d639367a303dadcfd0636127a0cd`.
Canonical ingestion provenance: PR #2 / `feat/m1-ingest` at
`954c9d69397f51fb8b3cf85f1250d96458b1b47f`. Its `apps/ingest` files and verified seed
registry are imported and extended; unrelated PR #2 blueprint documents are not imported.
Neither existing PR is merged or overwritten by this packet.

## Deliverables

1. Added compact `ResumeParse` and `MatchExplanation` Zod contracts using the OpenAI SDK's
   `zodResponseFormat`; all fields are required and optional values are nullable. The existing
   richer formats remain compatible. A match formatter requires SQL eligibility and fixes the
   model's score field to a server-supplied literal; every explanation quote can be validated
   against the job or resume. No matching LLM call is made before eligibility filtering.
2. `src/lib/resume/extract.ts` calls the SDK, rejects refusal/truncation, drops every item with
   an invalid exact quote, validates dates, and delegates month merging to the existing core.
   `verifyQuote` is an export alias for the unchanged exact substring verifier. 26 mocked tests
   cover resume extraction, interval edge cases, schema closure and score/quote validation.
3. `src/lib/http/safe_fetch.ts` resolves and validates public addresses once per hop and pins
   those addresses to the socket. Every redirect is validated again; three is the maximum.
   Requests stay GET-only and HTTPS-only, credentials are not forwarded cross-origin, and
   timeout/byte limits apply across the whole redirect chain. Per-host buckets bound bursts.
   42 mocked HTTP/rate-limit cases verify the transport without live network access.
4. Canonical `apps/ingest/src/adapters.ts` now uses safe fetching and Gemini's existing
   normalizers. Original `fetchBoard`/`JobListing` consumers and SmartRecruiters pagination
   remain supported. New root `fetchJobs(tenant)` methods delegate here. USAJOBS reads the
   specified server environment variables. 17 mocked canonical-adapter tests use the existing
   Gemini `tier1.json` fixture (the supplied tier1 fixtures, unchanged).
5. `src/lib/ingestion/dedup.ts` adds Packet 2's source/URL/identity/30-day normalized tiers,
   a >7-day repost detector and a GET active check. Tenant participates in exact source identity
   to avoid merging unrelated board-local IDs. Ten tests exercise the tier/window rules.
   The existing SimHash module stays available for its existing callers; persistence must
   choose an explicit rules version, not silently mix the two contracts.
6. Landing page and `/matches` server-component empty state are implemented. Navigation and
   viewport checks run in both desktop and mobile Playwright projects (four cases total).

## Protected inputs

No changes to `supabase/`, SQL filters, RLS tests, Gemini's `zod_provider_schemas.ts`, or its
fixtures. Protected-file diffs against the base are empty. No `any`, `@ts-ignore` or new
eslint-disable lines were introduced. No employer POST, application-submission endpoint,
paid source, prohibited board scraper, or Inngest integration is added.

D6–D9 remain locked: Cloudflare background infrastructure; Jobr prepares while the user may
optionally submit themselves; free sources only and JobsPipe deferred; Recruitee support
ends after February 10, 2027 (not enabled as an adapter here).

## Local verification

- `pnpm install --frozen-lockfile`: pass across both workspaces.
- `pnpm typecheck` and `pnpm --filter @jobr/ingest typecheck`: pass.
- `pnpm lint`: pass, zero warnings.
- `pnpm test:unit`: 249/249 pass. Measured critical source coverage including HTTP and the
  canonical adapters: statements 99.48%, branches 98.52%, functions 97.82%, lines 99.80%.
- `pnpm build`: pass; `/` and `/matches` are statically rendered server routes.
- The imported seed registry validates with 183 entries and 168 enabled entries. These are
  the current registry values, not a new live-board verification or the packet's older 172 count.
- `pnpm test:db` runs real Supabase pgTAP against the local stack. It requires the stack to
  be running; hosted CI performs startup/reset and runs this same command.

OpenAI calls are mocked; no live model/API charge or live ATS check is claimed. The inherited
Cloudflare probe remains undeployed; Workers runtime, queues and transactional persistence
are not verified by Node unit tests. The inherited offline rank CLI is a single-user sample,
not a multi-tenant API. All application submission remains outside Jobr.
