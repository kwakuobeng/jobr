# 09 — Multi-agent execution plan

## 1. What is actually available (checked 2026-10-14)
| Capability | Status | Evidence |
|---|---|---|
| GitHub connector (branches, PRs, issues, file contents, workflow runs) | **Available** [VF] | MCP namespace `cursor-github` in this environment (T2) |
| `cursor-origin` repo tools | **Available** [VF] | MCP catalog (T2) |
| Google Drive / Gmail / Notion / Cloudflare (bindings, builds, docs) connectors | **Available** [VF] | MCP catalog (T2) |
| Cursor cloud agents | Reported available to the parent agent. **Not callable from this subagent → UNCONFIRMED here.** Usage has been intermittently exhausted (per Kwaku; last reset Oct 7) [AV] | Brief + handoff notes |
| Direct Gemini / Claude / Codex APIs or CLIs on the box | **Not available** [VF] | `which codex claude gemini` → none. No API keys in env. No MCP tools (T2) |
| Codex (ChatGPT Plus, account Kobeng02) | Available to **Kwaku by hand** in the web UI. Known defect: "Unable to determine project root for task" is open in openai/codex #49497/#51123 even with published environments [VF T1] | T1 |
| Gemini, Claude | Assumed reachable by Kwaku through their consumer UIs [AV] | — |

**Implication [EI]:** Gemini, Claude and Codex are **human-relayed**. Kwaku pastes a prompt, the model produces an artifact, and Kwaku commits it (or Codex opens a PR). Grok Bot / Cursor agents orchestrate, review PRs through the GitHub connector, and run CI checks. **GitHub is the shared memory**: every handoff artifact lives in the repo under `docs/` or as a PR.

## 2. Workflow
1. Grok Bot (this blueprint) → `docs/blueprint/` in the repo.
2. **Gemini** (research) refreshes and extends file 03 → PR `docs/research/*`.
3. **Claude** (architecture review) red-teams files 05–08 → `docs/reviews/architecture-review.md` + an issue list.
4. **Codex** (implementation) takes backlog tasks (file 13) one per PR. CI is the arbiter.
5. Cursor cloud agent (when quota allows) or Grok Bot reviews PRs against acceptance criteria. When Cursor is exhausted, Codex PRs go through Grok Bot review via the GitHub connector [EI].

### Codex Web "project root" mitigation [EI from T1]
- Monorepo with a **single root `package.json`** (pnpm workspaces) and **`AGENTS.md` at the repo root**. Setup script starts with `cd "$(git rev-parse --show-toplevel)"`.
- Wait for "Environment published" before creating a task. Then run a smoke task that prints `pwd` and `git rev-parse --show-toplevel`.
- If the error persists, use the differential test from #49497 (new task vs. message to an existing task). Fall back to **Codex CLI locally** on KWAKU-DESKTOP, or to Cursor. Don't block on Codex Web.

---

## 3. Prompt A — Gemini (research)
```
ROLE: You are a primary-source research analyst for "Jobr", an AI job discovery/matching/approval/tracking SaaS.

CONTEXT: Jobr ingests jobs only from official, terms-compliant sources. Current plan: Greenhouse Job Board API, Lever Postings API, Ashby public posting API, SmartRecruiters Posting API, USAJOBS, user-forwarded alert emails, and user-pasted URLs parsed via schema.org JobPosting JSON-LD. LinkedIn, Indeed and ZipRecruiter are excluded (terms). Workday has no public cross-tenant API. Every application submission requires explicit per-submission human authorization. No scraping that violates terms, no CAPTCHA/anti-bot circumvention.

OBJECTIVE: Re-verify and extend docs/blueprint/03-job-acquisition-research.md with primary sources only.

INPUTS: The attached file 03 (feasibility matrix + UNCONFIRMED list).

TASKS:
1. For each UNCONFIRMED item, find the vendor's own page (docs, ToS, pricing) and resolve it or keep it UNCONFIRMED with what you tried. Priority: Greenhouse/Lever/Ashby/SmartRecruiters terms for third-party aggregation of public posting data and GET rate limits; ZipRecruiter terms re automated access; Adzuna commercial license terms; Coresignal job-data provenance and redistribution rights; Ashby application API auth model; iCIMS/Taleo public posting APIs.
2. Identify up to 5 additional licensed job-data sources with US coverage of sales/RevOps roles; give access model, auth, terms, rate limits, price, provenance.
3. Estimate (with method) the share of US Account Executive / RevOps postings hosted on Greenhouse+Lever+Ashby+SmartRecruiters vs Workday/iCIMS. Label as estimate.

CONSTRAINTS: Primary sources only (vendor domains, RFCs, government sites). Every claim gets a URL, access date, and a label: Verified fact / Documented limitation / Engineering inference / Assumption to validate. Never invent capabilities, prices, or permissions. Quote the exact sentence for any terms claim.

DELIVERABLES: (a) docs/research/03-addendum.md; (b) an updated feasibility matrix table; (c) a list of remaining UNCONFIRMED items.

ACCEPTANCE CRITERIA: Every row has ≥1 primary URL with an access date. Zero unlabeled claims. Terms claims include verbatim quotes. All items from the input UNCONFIRMED list are addressed.

VERIFICATION: A reviewer can open every URL and find the quoted text. Spot-check 5 random claims.

HANDOFF ARTIFACTS: The markdown files above, committed via PR titled "research: job-acquisition addendum (Gemini)".
```

## 4. Prompt B — Claude (architecture review)
```
ROLE: Principal engineer performing an adversarial architecture and security review of "Jobr".

CONTEXT: Stack: Next.js on Vercel (UI/API), Supabase (Postgres, Auth, RLS, pgvector, Storage, pg_cron), Cloudflare Workers + Queues (ingestion, scoring, digests), Cloudflare Email Worker (per-user forwarding alias), Resend (digests), OpenAI embeddings + small model. Hard rules: (1) every application submission requires explicit, per-submission human authorization; Jobr never submits forms itself; (2) no terms-violating scraping, no CAPTCHA/anti-bot circumvention; (3) zero exclusion violations (blacklist / do-not-reapply / duplicates / closed jobs) in any surfaced list; (4) strict tenant isolation.

OBJECTIVE: Find design flaws before code exists.

INPUTS: docs/blueprint/05-architecture.md, 06-matching-engine.md, 07-database-schema.md, 08-product-ux.md, 14-validation-framework.md.

TASKS:
1. Threat-model (STRIDE) the inbound email lane, the authorization flow, RLS, and the service-role key in Workers. Include prompt injection via job descriptions and emails.
2. Check the state machine and DB invariants: can any path reach submitted_* without a consumed authorization? Can duplicates slip through (reposts, multi-source, imported legacy rows)?
3. Check the RLS policies and SECURITY DEFINER RPCs for privilege escalation and cross-tenant leaks.
4. Check failure modes: partial board fetch, queue redelivery (idempotency), embedding model change, digest double-send, timezone/DST for 07:00 CT.
5. Challenge the vendor choice (Cloudflare vs Trigger.dev vs Supabase-only) using only documented limits.

CONSTRAINTS: Cite the blueprint line or vendor doc for each finding. Label each finding Verified fact / Documented limitation / Engineering inference / Assumption to validate. Don't redesign the product scope; propose minimal changes. No code beyond short SQL/pseudocode snippets.

DELIVERABLES: docs/reviews/architecture-review.md containing: findings table (id, severity P0–P3, component, issue, evidence, fix, test to add), revised invariants, and a decision log of anything you'd change.

ACCEPTANCE CRITERIA: ≥1 explicit test proposed per P0/P1 finding. Every hard rule (1–4) has an explicit "can it be violated? how is it prevented? how is it tested?" answer.

VERIFICATION: Findings map to validation IDs V1–V12 in file 14 or propose new IDs.

HANDOFF ARTIFACTS: The review file plus GitHub issues (one per P0/P1), labeled "arch-review".
```

## 5. Prompt C — Codex (implementation, per task)
```
ROLE: Senior full-stack engineer implementing ONE backlog task for "Jobr" in the existing monorepo.

CONTEXT: Monorepo (pnpm): apps/web (Next.js), workers/ingest (Cloudflare Workers + Queues), packages/core (shared TS types, scoring, normalization), supabase/migrations (SQL). Read AGENTS.md first. Hard rules: never implement code that submits an application to an employer/ATS; never fetch linkedin.com, indeed.com, ziprecruiter.com, or any login/CAPTCHA-protected page; never bypass robots.txt or rate limits; all user tables have RLS.

OBJECTIVE: Implement backlog task <TASK-ID>: <TITLE> exactly as specified in docs/blueprint/13-backlog.md.

INPUTS: docs/blueprint/07-database-schema.md (schema), 06 (matching), 08 (state machine), 14 (validation), the task's acceptance criteria, and fixtures in tests/fixtures/.

CONSTRAINTS: Smallest change that passes. TypeScript strict. No new dependencies without a note in the PR. No secrets in code; use env vars listed in .env.example. Migrations are additive and reversible. Write tests first for the acceptance criteria.

DELIVERABLES: One PR on branch task/<TASK-ID> containing code, tests, migration (if any), and an updated CHANGELOG line.

ACCEPTANCE CRITERIA: The task's criteria from file 13; `pnpm lint && pnpm typecheck && pnpm test` pass; if schema changed, `supabase db reset` + RLS tests pass; no rule above violated (CI grep guard for forbidden hosts and ATS POST endpoints).

VERIFICATION: Paste the test output summary in the PR body. List files changed and why.

HANDOFF ARTIFACTS: PR link, test summary, and any follow-up tasks discovered (as checklist items in the PR body).
```
