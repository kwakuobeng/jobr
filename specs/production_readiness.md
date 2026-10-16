# Production readiness — 2026-10-16

Baseline: main `7221a57661469db3494d05979e2e750351ecd201` (PRs #6–#15 merged).
This branch prepares a reviewable release; it does not apply migrations, run a
production backfill, create accounts, deploy Workers, or enable Cron.

## Evidence and limits

| Check | Result in this workspace |
| --- | --- |
| Frozen install | Passed, pnpm 11.25.0 / Node 24 |
| TypeScript / lint | Passed, lint enforces zero warnings |
| Unit, mocked integration, security | 362 tests passed across 23 files |
| Resume / ingestion coverage | 99.78% statements, 98.42% branches, 98.98% functions, 100% lines |
| Next production build | Passed |
| OpenNext Cloudflare app bundle | Passed (`opennextjs-cloudflare build`) |
| Ingestion Worker dry-run bundle | Passed; no deployment |
| Public `/api/health` | HTTP 200, `{"ok":true}` at documented Workers origin |
| Local HTTP Playwright smoke | Passed (desktop health request; no browser required) |
| Browser suite | 14 cases discovered; local browser unavailable (download returned an invalid archive; original dev startup also hit restricted network-interface enumeration, addressed by binding the test server to loopback) |
| Real local Supabase tests | Blocked: CLI cannot inspect a running local database; Docker unavailable |
| Public Playwright smoke | Direct Node DNS blocked (`EAI_AGAIN`); curl through the environment proxy succeeds |
| Hosted migration / Workers release / queues | Unknown: no deployment or database credentials in this workspace |
| Authenticated user journey / Storage HTTP isolation | Pending dedicated test accounts and target environment |

The baseline PR #15 CI passed; this does not validate subsequent branch changes.
The new PR's CI must pass its checks, browser and real Supabase jobs before merge.
A public health response proves reachability only, not release identity, migration
history, authentication, matching quality, or functioning ingestion.

## Corrections in this branch

- Stream ingestion bodies with a 5 MiB **byte** cap, reject oversized declared
  lengths, cancel overflowing streams, retain the 20-second timeout and manual
  redirects, and reject nonstandard ports. This intentionally rejects large boards
  rather than silently raising the limit. Logs/retries expose those failures.
- Enable `global_fetch_strictly_public` on the ingest Worker, matching the root
  Worker. The fetch transport is for fixed official provider hosts and relies on
  Workers' public-egress enforcement at connection time. It is not a replacement
  for the DNS-pinned Node SSRF client for arbitrary user URLs.
- Remove explicit `any` types and lint suppressions from ingestion/profile embedding
  clients. Parse the stored embedding hash through Zod.
- Log source IDs, providers and boards, plus a per-batch queue summary. Embedding
  errors are counted separately; source success is not retried for an embedding
  outage. Cron synchronization/housekeeping failures reject instead of appearing
  successful.
- Expand anonymous browser smokes to all protected page roots, health, and auth
  form navigation at desktop/mobile sizes. `PLAYWRIGHT_BASE_URL` optionally targets
  an already-running deployment and bypasses local server startup. These tests
  perform public GET requests only and do not prove authenticated behavior.

## Release sequence

1. **Read current hosted state first.** An operator with existing project access
   should compare Supabase migration history through 0009, inspect the deployed
   root/ingest Worker versions and bindings, and confirm queues, Cron and secrets.
   Record the actual state rather than assuming the PR handoff is still pending.
2. **Review migration 0009 against current data.** It changes both vector columns
   using `USING NULL`, clearing existing embeddings. The original PR's zero-row
   observation is historical. Count populated embeddings now, confirm a backup
   and re-embedding plan, review DDL/index rebuild impact and hosted migration
   history, and coordinate the app release. Never replay/edit migrations 0001–0009
   or reset a production database. Apply only missing migrations through the
   existing operator workflow after release approval.
3. **Backfill in a controlled window.** Run
   `pnpm exec tsx scripts/backfill-match-quality.ts` first (read-only default).
   It needs `SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY`. Review its
   region counts, then approve the `--apply` run. Embeddings additionally require
   `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with Workers AI permission.
   The dry run reports region changes; it does not call AI or preview merge counts.
   Apply performs region updates, duplicate merging, then embedding. It is not
   one transaction; record partial progress and inspect failures before rerunning.
4. **Deploy the root Worker with AI bound.** Build with the target public Supabase
   URL/anon key; keep service-role and AI-provider keys server-only. Verify Auth
   Site URL/callback allowlists. AI resume extraction is optional and separate from
   the Workers AI embedding binding. Grok Bot's review quota does not establish
   whether the application's XAI API key has quota.
5. **Provision/verify ingestion separately.** Ensure `jobr-ingest-sources` and
   `jobr-ingest-dlq` exist before deployment. Set the ingest Worker's service-role
   secret; configure USAJOBS key and email only if using it. Review account CPU,
   queue and Workers AI limits; free data sources do not imply unlimited free
   infrastructure. Deploy `apps/ingest/wrangler.jsonc` only after the RPCs exist.
6. **Observe an actual scheduled run.** Confirm each active source is enqueued,
   consumer successes/failures appear with source identity, jobs persist, retries
   reach the DLQ after exhaustion, and embeddings make progress. Successful
   housekeeping, a dry-run bundle, and a scheduled trigger alone are insufficient.
   The worker defaults to hourly Cron and may exceed limits on large boards.

## User-journey acceptance on the release target

Use disposable accounts A and B and synthetic PDF/DOCX resumes. Never put real
resume text, tokens, passwords or service-role keys in test output or PRs.

1. Sign up/confirm email, sign in, and sign out; verify the callback's safe local
   destination. Anonymous `/app`, `/resume`, `/preferences`, `/matches` must redirect.
2. As A upload each format; verify evidence quotes and dates against the source.
   Distinguish explicit and Suggested skills; accept/dismiss suggestions, edit
   chips, save, reload, then explicitly select **Use for matching**. Re-parse an
   old parser version and check approval/version state.
3. Save preferences and reload. Match feed must honor region, workplace, commute
   and salary filters before the result limit. Inspect employer diversity,
   duplicate-office merging, stable score ordering, empty/error states and
   approved-chip relevance. Confirm profile embedding updates only when inputs
   change and that an AI outage still allows lexical matching.
4. As B attempt direct access to A's resume object path through the authenticated
   Storage API and to owned resume/profile/preferences API resources. All must
   fail without exposing data. Public object URLs must fail too. pgTAP alone
   cannot prove Storage HTTP enforcement.
5. Verify desktop/mobile layouts and links to official listings. Jobr must never
   submit/POST an application to an ATS. Use only permitted free sources.
6. Record target URL, deployed version, migration version, timestamp, sanitized
   evidence and failed steps. Fix regressions in a new PR; retain independent
   review before merge/release. Do not use the older open PR #3 as an integration
   shortcut: compare any still-needed changes against current main first.

Public smoke command (does not create users or alter data):

```sh
PLAYWRIGHT_BASE_URL=https://jobr.kwakubobeng.workers.dev pnpm test:e2e
```

## Recovery

If ingestion misbehaves, pause its scheduled trigger/consumer through the existing
operator controls and inspect logs/DLQ before replaying messages. Preserve persisted
jobs and queue evidence. For app failures, restore a known-good compatible Worker
version; migration 0009 is not automatically reversed by rolling back code. Do not
run destructive schema rollback SQL or repeat the vector conversion as recovery.
Re-embedding can be resumed after the cause is fixed. Retest the complete journey
and obtain the normal independent review before closing the release gate.
