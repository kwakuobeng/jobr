# 13 — Codex backlog (small, testable tasks)

Each task is one PR. "AC" = acceptance criteria. Use Prompt C (file 09) with the task ID.

## Phase 1: Foundations
| ID | Task | AC |
|---|---|---|
| J-01 | Monorepo scaffold (pnpm workspaces: apps/web, workers/ingest, packages/core, supabase/) + root `AGENTS.md` + `.env.example` | `pnpm i && pnpm lint && pnpm typecheck` green on fresh clone. `git rev-parse --show-toplevel` documented in AGENTS.md |
| J-02 | CI workflow (lint, typecheck, unit tests, supabase db reset, RLS tests) | Fails on a deliberately broken test. Green on main |
| J-03 | CI guard: forbidden hosts (linkedin.com, indeed.com, ziprecruiter.com) and ATS application POST paths must not appear in source | Guard fails on a planted string. Passes otherwise |
| J-04 | Migration: tenancy tables (`user_profiles`, `user_preferences`, `user_documents`) + RLS | Two-user test: user B cannot select/update A's rows |
| J-05 | Migration: catalog tables (`companies`, `company_aliases`, `sources`, `company_boards`, `source_runs`) | Constraints tested (unique board per source/region) |
| J-06 | Migration: `jobs`, `job_sources`, `job_source_snapshots`, `job_embeddings` + indexes | FTS column populated. Dedupe index exists |
| J-07 | Migration: `exclusion_rules`, `matches`, `match_feedback` + RLS | Check constraint on company vs pattern enforced |
| J-08 | Migration: `applications`, `application_packages`, `submission_authorizations`, `application_events` + unique indexes | Duplicate (user, job) insert fails. Second active app for same company + family fails |
| J-09 | Cooldown/do-not-reapply trigger on `applications` insert | Insert within cooldown or for a do-not-reapply company raises an error |
| J-10 | Supabase Auth (magic link) + protected layout in Next.js | Unauthenticated request → redirect. Session cookie works |

## Phase 2: Ingestion
| ID | Task | AC |
|---|---|---|
| J-11 | `packages/core/normalize`: canonical Job type + title normalizer + dedupe key | Unit tests on 30 fixture titles. Same role across 2 sources → same key |
| J-12 | Greenhouse connector (`/jobs?content=true`, decode HTML entities, `pay_input_ranges` via job detail when needed) | Contract test vs. recorded fixture. Fields mapped per file 03 |
| J-13 | Lever connector (global + EU, `mode=json`, pagination) | Fixture test incl. `salaryRange`, `workplaceType` |
| J-14 | Ashby connector (`includeCompensation=true`, drop `isListed=false`) | Unlisted jobs never persisted as open |
| J-15 | SmartRecruiters connector (paginate `offset/limit`, ≤10 rps) | Paginates a 5k-posting fixture. Respects the limiter in test |
| J-16 | Fetch gate: source allow-list + terms-reviewed flag + robots.txt (RFC 9309 parser, 24 h cache, 5xx = disallow) + per-host token bucket + host deny-list | Tests: disallowed path blocked. 5xx robots → blocked. Deny-listed host → blocked. Challenge/403 → `blocked` status, no retry |
| J-17 | Board detector: careers URL → (source, token), validated by one API call | 12 URL fixtures across 4 ATSs detected correctly |
| J-18 | Worker: Cron Trigger → enqueue one message per active board. Queue consumer → fetch → `source_runs` | Local miniflare test: 3 boards → 3 runs recorded |
| J-19 | Upsert pipeline: `jobs` + `job_sources`, `content_hash`, `last_seen_at` | Re-running the same payload is idempotent (row count unchanged) |
| J-20 | Expiry: `missing_runs` ≥2 on successful runs → closed. `valid_through` past → closed | Property test over random presence sequences |
| J-21 | DLQ + retry policy + failure-rate metric | Poison message lands in DLQ after N retries |
| J-22 | Seed script: import companies/ATS hints from tracker CSV | 141 rows → companies created. Known ATS hosts → boards |
| J-23 | JSON-LD parser for a user-pasted URL (single fetch through the gate) | Fixtures: valid, missing fields, expired `validThrough` |
| J-24 | USAJOBS connector (optional, key in env) | Fixture test. Disabled when no key |

## Phase 3: Matching
| ID | Task | AC |
|---|---|---|
| J-25 | Embedding worker (text-embedding-3-small, batch, skip unchanged hash) | Unchanged job not re-embedded |
| J-26 | LLM extraction (seniority, workplace, pay, requirements) with JSON schema + validation | Invalid JSON → retry once → mark `extraction_failed` |
| J-27 | Hard-filter SQL function `candidate_jobs(user_id)` | Property test: blacklisted, do-not-reapply, applied and closed jobs never returned |
| J-28 | Lexical + vector scoring + RRF fusion | Deterministic ranks on fixture set |
| J-29 | Weighted score + components JSON + buckets | Unit tests per component edge case |
| J-30 | Grounded explanation generator + substring check + template fallback | Fabricated quote → falls back to template |
| J-31 | `eval:matching` CI job over the golden set | Reports P@10, nDCG@10, violations. Fails if violations >0 |

## Phase 4: Review & tracker
| ID | Task | AC |
|---|---|---|
| J-32 | Today screen (cards, shortlist, hide with reason) | Playwright: hide with "company" reason creates an exclusion rule |
| J-33 | Job detail (component bars, provenance, evidence) | Shows first/last seen and source |
| J-34 | Tracker import from Google Sheet CSV (status mapping per Jobber taxonomy) | Kwaku's 141 rows imported. Counts per status equal the review file |
| J-35 | State-machine RPCs (SECURITY DEFINER): shortlist, prepare, authorize, mark_submitted, confirm | Illegal transitions rejected. Direct UPDATE of state denied |
| J-36 | Tracker UI (table + kanban, filters) + ghosted rule (pg_cron) | 30-day confirmation-only apps → ghosted |

## Phase 5: Digest & email
| ID | Task | AC |
|---|---|---|
| J-37 | Digest builder (top N above threshold, unique user+date) + Resend send + `digests` status | Double invocation sends once |
| J-38 | Timezone-correct scheduling (UTC cron, per-user local 07:00, DST) | Tests across DST boundaries |
| J-39 | Email Worker: alias → user lookup → store → classify (alert/confirmation/rejection/interview) | 20 fixture emails classified ≥95% |
| J-40 | HiringCafe alert parser + redirect resolver limited to allow-listed ATS hosts | Fixture from `/workspace/job-review/raw` parsed. Non-ATS links not fetched |
| J-41 | Confirmation matcher: email → application (company + title + time window) → `submitted_confirmed` with evidence | No match → no state change |
| J-42 | Heartbeat monitor: alert if no successful ingestion/digest in 26 h | Simulated outage triggers an alert |

## Phase 6: Prep & authorization
| ID | Task | AC |
|---|---|---|
| J-43 | Package generator (answers from Greenhouse `questions`, cover letter), versioned + sha256 hash | EEO/demographic fields never auto-filled |
| J-44 | Authorize flow: single-use, 30-min TTL, bound to hash. Edit invalidates | Property tests V6 |
| J-45 | "Did you submit?" prompt + attestation event | Attestation creates an event with evidence |
| J-46 | Data export (JSON/CSV) + account deletion job | Deleted user's rows gone after the job. Storage objects removed |
