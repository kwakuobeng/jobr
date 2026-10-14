# 12 — Risk register

Scoring: Likelihood (L) and Impact (I) on a 1–5 scale. Score = L×I.

| ID | Risk | L | I | Score | Mitigation | Owner | Trigger / early signal |
|---|---|---|---|---|---|---|---|
| R1 | Coverage gap: target roles sit on Workday/iCIMS/LinkedIn-only, not on the four ATS APIs | 4 | 4 | 16 | Measure coverage in Phase 2 against Kwaku's last 60 days of alert emails. Pasted-URL JSON-LD. Forwarded alerts. Licensed aggregator in Phase 7 | GB/G | <60% of alert-email jobs resolvable to an ingested source |
| R2 | ATS public endpoints change or start rate-limiting (no documented GET limits) [DL S1–S3] | 2 | 4 | 8 | Contract tests on fixtures. Per-host token bucket ≤1 rps. Backoff on 429. DLQ. Alert on failure rate >2% | X | `source_runs` failure spike |
| R3 | Terms ambiguity for commercial reuse of public ATS posting data (UNCONFIRMED) | 3 | 4 | 12 | Link out (no republishing of full JDs publicly). Attribute the source. Legal read before charging | K | Vendor notice or cease-and-desist |
| R4 | Accidental fetch of prohibited hosts (LinkedIn/Indeed/ZipRecruiter) via email links | 3 | 5 | 15 | Host deny-list in the fetch gate + CI grep guard + test V1c. Resolve redirects only to the allow-listed ATS hosts | X | Any deny-listed host in fetch logs |
| R5 | An unauthorized or "phantom" submission recorded | 2 | 5 | 10 | DB-enforced state machine. Single-use authorization. No submit code path. V6/V7 tests | X/C | Any `submitted_*` without a consumed authorization |
| R6 | Exclusion violation (blacklisted or do-not-reapply company surfaced) | 3 | 4 | 12 | Hard filter in SQL + company alias table + property tests + digest pre-send assertion | X | V3 >0 |
| R7 | Ranking quality too low for a hybrid AE + RevOps profile | 3 | 4 | 12 | Separate title-family profiles. Golden set. Feedback weights. Explain-don't-score LLM | X/K | P@10 <0.7. 👎 rate >50% |
| R8 | Email lane breaks (template drift, forwarding verification, spam filtering) | 4 | 3 | 12 | Parser fixtures per sender. Fallback "unparsed" queue shown to the user. Alias health check | X | Parse-failure rate >10%/week |
| R9 | Prompt injection via job descriptions or emails steering LLM drafts | 3 | 3 | 9 | Treat as data. Strict JSON schema outputs. No tool access in LLM calls. Grounding check | C/X | Grounding check failures |
| R10 | Tenant data leak (RLS gap, service-role key exposure) | 2 | 5 | 10 | RLS on all user tables. Two-user tests in CI. Service key only in Workers/server. Secret scanning | X/C | V10 failure. Secret-scan alert |
| R11 | Agent capacity: Cursor quota exhaustion. Codex Web "project root" defect [VF T1] | 4 | 3 | 12 | Repo hygiene (file 09). Codex CLI local fallback. Small PRs. GitHub as memory | K/GB | Blocked >1 day |
| R12 | Scheduler misses (cron drift, DST, queue backlog) | 2 | 4 | 8 | UTC cron with user-TZ send. Heartbeat alert at 26 h. Idempotent digest (unique user+date) | X | V8 failure |
| R13 | Cost overrun from LLM explanations at scale | 2 | 3 | 6 | Top-5 explanations, caching, nano model, budget alarms | GB | $/user > $0.50 |
| R14 | Product-market risk: Kwaku's own search tapering (accepted offer, start 2026-11-10) reduces dogfooding [AV] | 3 | 3 | 9 | Recruit 10–20 cohort users by Phase 5 | K | <3 active days/week |
| R15 | Gmail/Outlook OAuth later requires CASA (restricted scopes) [DL P19] | 2 | 3 | 6 | Stay on the forwarding alias. Budget CASA only if inbox sync becomes core | K | Feature request volume |
