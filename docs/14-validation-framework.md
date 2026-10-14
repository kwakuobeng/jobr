# 14 — Independent validation framework (Section 2D items)

Run by a reviewer who did not write the code (Claude review, or Grok Bot via the GitHub connector), against **prod-like data**. Results go in `docs/validation/<date>.md`. A release ships only if every **Gate** item passes.

| ID | Item (2D) | Test method | Metric | Pass threshold | Gate? |
|---|---|---|---|---|---|
| V1a | Genuine listings | Random sample of 100 open jobs/week. Reviewer opens `canonical_url` | % live on the employer/ATS page with matching title and company | ≥ 98% | Gate |
| V1b | Genuine listings: provenance | Every surfaced job has ≥1 `job_sources` row from an allow-listed source | % with valid provenance | 100% | Gate |
| V1c | Compliant acquisition | Grep fetch logs for deny-listed hosts. Robots-disallowed paths. Requests after a challenge/403 | Count | 0 | Gate |
| V2 | Extraction accuracy | 100 labelled jobs: title family, seniority, workplace type, pay min/max, location | Field-level accuracy. Pay exact-match when present in the source | Title family ≥ 95%, workplace ≥ 95%, location ≥ 95%, seniority ≥ 85%, pay ≥ 98% (no hallucinated pay: 0) | Gate |
| V3 | Exclusions | Property test (10k random profiles × fixtures) + audit of every digest sent in the last 7 days | Blacklisted, do-not-reapply, already-applied, or closed jobs surfaced | **0** | Gate |
| V4a | Dedupe | Seeded set of 50 known cross-source duplicates + 50 near-miss distinct roles | Precision / recall of merge | Recall ≥ 95%, precision ≥ 99% | Gate |
| V4b | Expiry | Remove 30 fixture jobs from board payloads. Set 10 `validThrough` dates in the past | Jobs closed within 2 successful runs. Never surfaced after close | 100% closed within 2 runs. 0 surfaced | Gate |
| V5 | Calibration | 4 weeks of 👍/👎 by bucket | 👍-rate Strong vs Worth. ECE (5 bins) | Strong ≥ 0.65, Worth ≥ 0.35, monotonic, ECE ≤ 0.10 | Gate after 200 labels |
| V6 | No unauthorized submission | (a) Static: CI guard, no ATS application POST or form-submit automation code. (b) DB property tests: random transition sequences. (c) Pen-test: call RPCs with a stale or foreign authorization | `submitted_*` without a consumed, matching, unexpired authorization | **0**. Every illegal transition rejected | Gate |
| V7 | True submission status | Audit 50 applications: status vs evidence (confirmation email or attestation) | `submitted_confirmed` without evidence. Status mismatches | 0 without evidence. Mismatch ≤ 2% | Gate |
| V8 | Scheduler reliability | 20 consecutive weekdays of `source_runs`/`digests` + chaos test (kill a worker mid-run, inject 429s) | Ingestion run success. Digest on-time (±10 min of 07:00 local). Duplicates | ≥ 99% on-time. 0 duplicate digests. ≥ 98% boards succeed per run | Gate |
| V9 | Digest accuracy | For 10 digests: re-run scoring offline and compare. Check every link | Items match top-N of offline scoring. Dead links | 100% match. Dead links ≤ 1% | Gate |
| V10 | Tenant isolation | Automated: two users × every table × select/insert/update/delete via the anon key + JWT. Storage cross-access attempt | Cross-tenant reads/writes | **0** | Gate |
| V11 | Failure handling | Fault injection: ATS 500/429/timeout, malformed JSON, OpenAI outage, Resend outage, email parse failure | Run marked partial/failed with error. Retry/backoff. DLQ. User-visible degradation notice. No data loss | 100% of injected faults handled per spec. 0 crashes that drop a digest silently | Gate |
| V12 | Mobile | Playwright at 375×812 and 414×896. Lighthouse mobile | Core flows (review, shortlist, prepare, authorize) completable. Tap targets ≥ 44 px. Lighthouse perf/accessibility | 100% flows pass. Perf ≥ 80, A11y ≥ 90 | Gate (Phase 4+) |

**Cadence:** V3, V6 and V10 run in CI on every PR. V1, V4 and V8 run weekly in prod. V2, V5, V7, V9 and V11 run per release. V12 runs on UI changes.
