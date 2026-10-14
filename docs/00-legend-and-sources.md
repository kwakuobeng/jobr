# 00 — Evidence legend and source register

**Claim labels** (used in every file):
- **[VF] Verified fact**: read on a primary source (vendor docs, terms, pricing page, RFC) on the date shown, or observed directly by a live probe.
- **[DL] Documented limitation**: a limit, restriction or prohibition stated by the vendor.
- **[EI] Engineering inference**: my reasoning from verified facts; not stated by any vendor.
- **[AV] Assumption to validate**: a working assumption that needs a test, a quote or a legal read before we rely on it.
- **UNCONFIRMED**: I tried and could not verify it from a primary source. Do not build on it.

All sources below were accessed **2026-10-14 (CT)**, unless a different date is noted. Prices are in USD unless a different currency is noted, and they exclude tax.

## Job sources
| # | Source | URL | What it established |
|---|---|---|---|
| S1 | Greenhouse Job Board API | https://developers.greenhouse.io/job-board.html | GETs are public with no auth. The application POST needs the employer's Basic-auth API key. Fields and validations |
| S2 | Lever Postings API README | https://github.com/lever/postings-api (raw README.md) | Public GET by site name. The apply POST needs an employer API key. 429 above 2 POST/s. hostedUrl/applyUrl/salaryRange |
| S3 | Ashby Job Postings API | https://developers.ashbyhq.com/docs/public-job-posting-api | Public GET by board name, `includeCompensation`, jobUrl/applyUrl, isListed |
| S4 | SmartRecruiters Posting API + endpoints + rate limits | https://developers.smartrecruiters.com/docs/posting-api · /docs/endpoints · /docs/rate-limiting · /reference/v1listpostings | Public postings. The OAuth scope is required only for INTERNAL destinations. 10 req/s, 8 concurrent for most endpoints |
| S5 | Live probes (box, 2026-10-14 ~06:40 CT) | api.smartrecruiters.com/v1/companies/BoschGroup/postings → 200, totalFound 5033. Greenhouse/Lever/Ashby list endpoints → 200 | Unauthenticated GET works today |
| S6 | Workday Recruiting web service (tenant-scoped) | https://community.workday.com/sites/default/files/file-hosting/productionapi/Recruiting/v42.1/Recruiting.html | The official API is per tenant (Get_Job_Postings, Post_Job). No public cross-tenant jobs API was found |
| S7 | Google JobPosting structured data | https://developers.google.com/search/docs/appearance/structured-data/job-posting | Required/recommended properties, `validThrough` expiry rules, `directApply` |
| S8 | LinkedIn User Agreement (eff. 2025-11-03) | https://www.linkedin.com/legal/user-agreement §8.2 | Prohibits scraping, bots, and copying data obtained through third parties |
| S9 | LinkedIn Job Posting API overview | https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview | Approved partners only. "Currently not accepting new partnerships." Posting-direction API (ATS → LinkedIn) |
| S10 | Indeed Terms of Service (Last Updated 2026-09-29) | https://www.indeed.com/legal | No bots/scrapers/AI agents without express written permission. No ML training |
| S11 | Indeed developer docs | https://docs.indeed.com/ | Redirects to login (401). Public partner API terms **UNCONFIRMED** |
| S12 | ZipRecruiter Terms | https://www.ziprecruiter.com/terms | Cloudflare bot challenge, 403. **UNCONFIRMED** (not bypassed, on purpose) |
| S13 | Adzuna API ToS | https://developer.adzuna.com/docs/terms_of_service | Default 25/min, 250/day, 1000/wk, 2500/mo. Commercial use beyond a 14-day trial needs agreement. Attribution required |
| S14 | USAJOBS developer: rate limiting + ToS | https://developer.usajobs.gov/guides/rate-limiting · /guides/terms-of-service | 10,000 rows/query, 500 rows/page. Public Data under an open license, commercial reuse allowed |
| S15 | The Muse API v2 + terms | https://www.themuse.com/developers/api/v2 · /v2/terms | 500 req/h unregistered, 3,600 req/h with key. Content must link back to themuse.com |
| S16 | Coresignal pricing | https://coresignal.com/pricing/ | Mini $49/mo for 2,000 credits up to Elite $5,000/mo. 1 credit per multi-source job posting |
| S17 | TheirStack pricing | https://theirstack.com/en/pricing | Company-credit packs ($109 for 1k up to $999 for 200k). Per-job API pricing **UNCONFIRMED** |
| S18 | RFC 9309 Robots Exclusion Protocol | https://www.rfc-editor.org/rfc/rfc9309.html | "Not a form of access authorization." Cache ≤24h. 5xx means assume full disallow |
| S19 | robots.txt files (live, 2026-10-14) | jobs.lever.co (Allow /, Crawl-delay 1), boards.greenhouse.io (Disallow /embed/), jobs.ashbyhq.com (Disallow /api/), hiring.cafe (Disallow /viewjob/ etc.), nvidia.wd5.myworkdayjobs.com | Per-host crawl rules |

## Platform, infrastructure and AI
| # | Source | URL | What it established |
|---|---|---|---|
| P1 | Vercel cron usage & pricing | https://vercel.com/docs/cron-jobs/usage-and-pricing | Hobby: once/day, ±59 min. Pro: per-minute. 100 crons/project |
| P2 | Vercel Functions limits | https://vercel.com/docs/functions/limitations | Hobby max 300 s. Pro 800 s (1,800 s beta) |
| P3 | Vercel Hobby plan | https://vercel.com/docs/plans/hobby | Hobby is "non-commercial, personal use only" |
| P4 | Vercel pricing | https://vercel.com/pricing | Pro $20/mo including $20 usage credit |
| P5 | Supabase pricing | https://supabase.com/pricing | Free: 500 MB DB, paused after 1 week inactive. Pro from $25 (8 GB disk, 100k MAU, $10 compute credit). Compute tiers |
| P6 | Supabase Cron | https://supabase.com/docs/guides/cron | pg_cron. ≤8 concurrent jobs and ≤10 min per job recommended |
| P7 | Supabase Queues | https://supabase.com/docs/guides/queues | pgmq. Guaranteed delivery, exactly-once within a visibility window |
| P8 | Supabase Edge Function limits | https://supabase.com/docs/guides/functions/limits | 150 s free / 400 s paid wall clock. **2 s CPU** per request. 256 MB |
| P9 | Supabase pgvector | https://supabase.com/docs/guides/database/extensions/pgvector | HNSW/IVFFlat with naive filtering can return fewer rows than requested |
| P10 | Inngest pricing | https://www.inngest.com/pricing | Free 50k executions. Pro from $99/mo, 1M executions |
| P11 | Trigger.dev pricing | https://trigger.dev/pricing | Free $5 credit/10 schedules. Hobby $10. Pro $50 |
| P12 | Cloudflare Workers pricing | https://developers.cloudflare.com/workers/platform/pricing/ | Paid $5/mo min. 10M req + 30M CPU-ms included. ≤5 min CPU/invocation, ≤15 min per Cron Trigger |
| P13 | Cloudflare Queues pricing | https://developers.cloudflare.com/queues/platform/pricing/ | 1M ops/mo included, then $0.40/M. About 3 ops per message. Retention up to 14 days |
| P14 | Cloudflare Workflows pricing | https://developers.cloudflare.com/workflows/reference/pricing/ | Step/storage billing from 2026-08-10. 500k steps included, then $0.80/100k |
| P15 | Cloudflare Email Workers + limits | https://developers.cloudflare.com/email-service/api/route-emails/email-handler/ · /email-service/platform/limits/ | `email()` handler for inbound mail. 25 MiB max. Catch-all `*@domain` routing |
| P16 | OpenAI API pricing | https://developers.openai.com/api/docs/pricing | Per 1M tokens, standard tier: text-embedding-3-small $0.02. gpt-5-mini $0.25 in / $2.00 out. gpt-5-nano $0.05/$0.40. gpt-5.4-mini $0.75/$4.50 |
| P17 | Resend pricing | https://resend.com/pricing | Free 3,000/mo, 100/day. Pro $20 for 50k. Scale $90 for 100k. Extra $0.90/1k |
| P18 | Gmail API scopes | https://developers.google.com/workspace/gmail/api/auth/scopes | `gmail.readonly` is a **restricted** scope |
| P19 | Google restricted-scope security assessment | https://support.google.com/cloud/answer/13465431 | Restricted scopes require an annual CASA assessment |

## Competitors
| # | Source | URL |
|---|---|---|
| C1 | Simplify+ pricing (help center) | https://help.simplify.jobs/articles/5623502-whats-included-in-simplify-features-and-pricing |
| C2 | Simplify Copilot | https://simplify.jobs/copilot · Chrome Web Store listing |
| C3 | Teal pricing | https://www.tealhq.com/pricing |
| C4 | Huntr pricing | https://huntr.co/pricing |
| C5 | LoopCV pricing | https://www.loopcv.pro/pricing |
| C6 | Jobright (own blog. No public pricing page found: /pricing returns 404) | https://jobright.ai/blog/is-jobright-worth-it-a-detailed-comparison/ |

## Tooling
| # | Source | URL | What it established |
|---|---|---|---|
| T1 | openai/codex issues #49497, #51123 | https://github.com/openai/codex/issues/51123 (references #49497) | "Unable to determine project root for task" is an open Codex Web defect, seen even with a published, runnable environment |
| T2 | Environment probe of this agent box (2026-10-14) | `which codex claude gemini` → none. No OpenAI/Anthropic/Gemini keys in env. MCP catalog: GitHub (`cursor-github`), `cursor-origin`, Google Drive, Gmail, Notion, Cloudflare; no Gemini/Claude/Codex tools | What agents can actually call |

## Reference workflow (Jobber), read from Kwaku's workspace
- `/workspace/kevin-obeng-application-tracker.csv` columns: Company, Role title, Applied date, Status, Latest update date, Outcome notes, Source (ATS/channel), Gmail thread URL/ID, Do not reapply.
- `/workspace/kevin-obeng-applications-review.md`: 141 applications across 130 companies. Status taxonomy: Offer, Interviewing, Applied, Unknown, Ghosted (30+ days with confirmation only), Rejected, Withdrawn, Blacklisted.
- `/workspace/job-review/inbox-jobs-2026-10-12.csv`: HiringCafe saved-search digest emails with SendGrid-wrapped links, plus `blacklisted` and `already_applied` flags.

**Brief gap:** the `MASTER-PROMPT.md` in `/workspace/jobr/` is a one-line stub. The original brief's **Section 16 questions** and **Section 2D** text were not available to me. Section 2D items are taken from the task message. The Section 16 questions are reconstructed in file 03 and marked as such.
