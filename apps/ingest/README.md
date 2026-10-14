# Jobr ingest (M1)

Local pipeline: public ATS board APIs → normalized `JobListing` → JSONL → ranked report. No LinkedIn/Indeed/ZipRecruiter, no application submission.

## Run
```bash
cd /workspace/jobr/apps/ingest
npm install
npm run pull      # fetch all enabled boards in ../../data/seed-boards.json
npm run rank      # filter + BM25 → data/ranked-top.json, data/ranked-report.md
npm run all       # both
# optional: npm run discover && npm run enrich   # re-probe candidate slugs and rebuild seed list
```
Env: `CONCURRENCY` (default 8), `TOPN` (50), `TRACKER` (default `/workspace/kevin-obeng-application-tracker.csv`; optional).

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
- `id = ats:token:sourceJobId` (primary, stable across pulls)
- `dedupeHash = sha1(norm(company)|norm(title)|norm(location))[:16]` (cross-board / repost dedupe; note it also collapses multi-headcount reqs with identical title+location)

## Worker
`worker/index.ts` is an undeployed Cloudflare Worker cron stub (shards boards to stay under subrequest limits). Supabase upsert is TODO (M2).
