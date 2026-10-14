# 16 — Unverified items (do not build on these until resolved)

| # | Item | Why unverified | How to resolve |
|---|---|---|---|
| U1 | Greenhouse, Lever, Ashby and SmartRecruiters terms for third-party aggregation of public posting data | No such terms found on developer docs. Probable terms URLs returned 404 | Gemini Prompt A + legal read |
| U2 | GET rate limits for Greenhouse, Lever and Ashby posting APIs | Not documented | Ask vendors. Self-limit ≤1 rps/host |
| U3 | ZipRecruiter terms on automated access | Terms page behind a Cloudflare bot challenge (not bypassed) | Read manually in a browser |
| U4 | Indeed public read/partner API | Developer portal requires login | Ask Indeed. Assume none |
| U5 | Adzuna commercial license price and terms | Requires contacting Adzuna | Request a quote |
| U6 | Coresignal and TheirStack job-data provenance and redistribution rights. TheirStack per-job API pricing | Not on pricing pages | Vendor diligence (Phase 7) |
| U7 | Ashby application-submission API and its auth model | Not covered by the public posting API doc | Check Ashby API docs |
| U8 | Presence of JSON-LD JobPosting on Workday/iCIMS job pages | Varies by tenant. Not sampled | Sample 20 pages via user-pasted URLs in Phase 2 |
| U9 | HiringCafe terms | Terms page returned 403 to the fetch | Read manually |
| U10 | Jobright current price | No official pricing page (404). Its blog states $29.99, $19.99 and $30 in different places | Check in-app |
| U11 | BM25 extension availability on Supabase | Not checked | Check Supabase extension list in Phase 3 |
| U12 | Vercel usage overage unit prices, Cloudflare R2 pricing, observability tooling cost | Not fetched | Fetch before the Phase 7 budget |
| U13 | Supabase Free "inactivity" definition (does cron count?) | Not documented on the pricing page | Use Pro |
| U14 | Cursor cloud agents' current availability and quota | Not callable from this subagent | Parent agent / Kwaku to confirm |
| U15 | Original brief's Section 16 questions and Section 2D wording | `MASTER-PROMPT.md` is a stub | Kwaku to supply. File 03 §4 holds reconstructed questions |
| U16 | Legal retention period for authorization audit records after account deletion | Jurisdiction-dependent | Privacy counsel before external users |
| U17 | Gmail/Outlook forwarding-verification flow to a Worker alias | Provider-side behavior not tested | Test in Phase 5 |

## Decisions approved by Kwaku Obeng — 2026-10-14

| # | Decision | Status |
|---|---|---|
| D1 | Source policy: ATS public feeds (Greenhouse, Lever, Ashby, SmartRecruiters) + USAJOBS API, user-forwarded job alerts, and user-pasted URLs. No scraping of gated boards. The user reviews, approves and submits every application. | Approved 2026-10-14 |
| D2 | Stack: Next.js on Vercel, Supabase (Postgres + pgvector + auth), Cloudflare Workers (email ingest/cron), OpenAI embeddings, Resend for outbound email. | Approved 2026-10-14 |
| D3 | Forwarded-alert ingestion via per-user forwarding addresses routed to a Cloudflare Worker (U17 still to be tested). | Approved 2026-10-14 |
| D4 | First users are a small external group, not only Kwaku, so U1, U16 (privacy/retention) and terms review must be resolved before onboarding them. | Approved 2026-10-14 |
| D5 | Private GitHub repo `kwakuobeng/jobr` holds the blueprint under `docs/`. No app code yet. | Approved 2026-10-14 |
