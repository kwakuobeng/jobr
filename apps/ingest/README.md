# Jobr ingest (M1)

Local pipeline: public ATS board APIs → normalized `JobListing` → JSONL → ranked report. No LinkedIn/Indeed/ZipRecruiter, no application submission.

## Run

From the repository root, `pnpm install`, then `pnpm exec tsx apps/ingest/src/pull.ts`.
Rank with `pnpm exec tsx apps/ingest/src/rank-cli.ts /path/to/profile.json`.
Optional discovery/enrichment use the corresponding `src/discover.ts` and `src/enrich.ts` commands.

Ranking requires a profile JSON object with `titleInclude`, `titleExclude`,
`locationPattern`, `keywordVeto` (case-insensitive regular expression strings),
`allowRemote` (boolean), and `query` (string). There is no default personal profile
or geographic/title boost. Filters and BM25 ranking use only this supplied profile.

Paths: `JOBR_DATA_DIR` defaults to the repository's `data/`. Override seed input
with `JOBR_SEED_PATH`, job input with `JOBR_JOBS_PATH`, profile with
`JOBR_PROFILE_PATH`, optional tracker CSV with `JOBR_TRACKER_PATH`, JSON output
with `JOBR_RANKED_PATH`, and Markdown output with `JOBR_REPORT_PATH`.
An explicitly configured missing tracker is an error. `CONCURRENCY` is 1–32
(default 8); `TOPN` is 1–1000 (default 50). Create parent directories for custom
output paths. Failures are logged as JSON with provider/board; run summaries
include failure counts (a probe 404 is counted, rather than silently ignored).

All outbound reads use the shared SSRF client: HTTPS GET only, pinned public DNS,
no redirect following, timeouts, and 5 MiB response limit. No ATS submission.

## Sources (public, unauthenticated, documented by vendor)
| ATS | Endpoint |
|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` |
| Lever | `https://api.lever.co/v0/postings/{token}?mode=json` |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{token}` |
| SmartRecruiters | `https://api.smartrecruiters.com/v1/companies/{id}/postings` (paginated, capped 1000) |

Each seed entry in `data/seed-boards.json` stores its `source` URL, `jobsAtVerify` and `verifiedAt` from the live probe.

## Outputs (`/workspace/jobr/data/`)
- `jobs-YYYY-MM-DD.jsonl`, `jobs-latest.json` — one normalized JobListing per line (Postgres-ready: `id` PK)
- `pull-report.json` — per-board ok/fail, latency, success rate
- `ranked-top.json`, `ranked-report.md`

## Dedupe

- `id = ats:token:sourceJobId` is stable across pulls.
- Hash includes normalized company, title, location, and the exact provider,
  board, and source job ID. Identical titles at different requisitions or locations
  survive. No cross-provider merge is inferred from similar titles alone.

## Worker (hourly refresh, D6)

`worker/index.ts` + `wrangler.jsonc` define the `jobr-ingest` Worker (code only, not deployed):

- **Cron** `0 * * * *` upserts the curated board list (`data/job-boards.json`, 150 Greenhouse/Ashby
  boards, each verified HTTP 200) into `job_sources`, adds USAJOBS when its key is set, and enqueues
  one message per active source. It also runs `merge_duplicate_postings` and `close_stale_jobs(48)`.
- **Queue consumer** pulls one source using `src/lib/ingestion/pipeline.ts` (fetch-only, host allowlist,
  no redirects, 20-second timeout, streamed 5 MiB body limit, and Workers public-egress restriction). It writes pages of 500 or fewer rows through `ingest_job_batch`, which upserts, merges
  per-office copies and stores region/country. It then embeds up to 100 new jobs with Workers AI
  (`@cf/baai/bge-base-en-v1.5`, 768-dim).
- Supported providers: Greenhouse, Ashby, Lever, USAJOBS. Workday is intentionally not implemented.
  SmartRecruiters has no normalizer in `specs/` yet.

First deploy (Kwaku): `wrangler queues create jobr-ingest-sources`, `wrangler queues create jobr-ingest-dlq`,
`wrangler secret put SUPABASE_SERVICE_ROLE_KEY -c apps/ingest/wrangler.jsonc` (optionally `USAJOBS_API_KEY`,
and set `USAJOBS_USER_AGENT_EMAIL`), then `wrangler deploy -c apps/ingest/wrangler.jsonc`.

Queue logs include `source_ok` / `source_failed` with source ID, provider and board,
followed by `queue_summary` counts for succeeded, skipped, failed, embedded and
embedding failures. Failed source messages retry; successful source writes stay
acked if the separate embedding pass fails. Embedding backlog is retried in later
batches or by the backfill. Cron source synchronization and housekeeping errors
reject the scheduled task. See `specs/production_readiness.md` for live gates.
