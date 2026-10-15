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

## Worker

`worker/index.ts` is an undeployed orchestration stub; its imported HTTP client
uses Node DNS and Undici. Cloudflare runtime compatibility and deployment remain
separate work; do not deploy this stub as-is. D6 specifies Workers/Queues/Cron
with application-managed idempotency. Supabase upsert remains M2.
