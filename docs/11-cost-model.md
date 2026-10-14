# 11 — Cost model (1 / 100 / 1k / 10k users)

## A. Documented prices (verified 2026-10-14; see file 00)
| Item | Price | Source |
|---|---|---|
| Supabase Pro | From $25/mo. 8 GB disk then $0.125/GB. 100k MAU. 250 GB egress. $10/mo compute credit. Compute: Micro $10, Small $15, Medium $60, Large $110 | P5 |
| Supabase Free | $0. 500 MB DB. **Paused after 1 week of inactivity**. Max 2 projects. No backups | P5 |
| Vercel | Hobby $0 (**non-commercial only**). Pro $20/mo including $20 usage credit | P3, P4 |
| Cloudflare Workers Paid | $5/mo min. 10M requests + 30M CPU-ms included, then $0.30/M requests and $0.02/M CPU-ms | P12 |
| Cloudflare Queues | 1M ops/mo included, then $0.40/M. About 3 ops/message | P13 |
| OpenAI | text-embedding-3-small $0.02/1M. gpt-5-nano $0.05 in / $0.40 out per 1M. gpt-5-mini $0.25 / $2.00 per 1M | P16 |
| Resend | Free 3,000/mo, 100/day. Pro $20 for 50k. Scale $90 for 100k. Overage $0.90/1k | P17 |
| Coresignal (optional) | Mini $49 (2k credits) up to Growth $1,000 (150k). 1 credit per job posting | S16 |
| Vercel usage overage unit prices, Cloudflare R2, Sentry, domain | **Not fetched → UNCONFIRMED.** Shown as estimates | — |

## B. Assumptions (all [AV])
| Assumption | 1 | 100 | 1k | 10k |
|---|---|---|---|---|
| Followed boards (shared registry) | 300 | 1,500 | 5,000 | 20,000 |
| Open jobs in corpus | 15k | 75k | 250k | 1M |
| New/changed jobs per day (3% churn) | 450 | 2,250 | 7,500 | 30,000 |
| Embedding tokens per job | 1,000 | ← | ← | ← |
| Extraction per new/changed job (gpt-5-nano): 1,500 in + 300 out = **$0.000195** | | | | |
| Explanations: top 10/user/weekday, 22 days. 1,200 in + 250 out (gpt-5-mini) = **$0.0008 each → $0.176/user/mo** | | | | |
| Prepared packages: 6/user/mo average (Kwaku: 20). 5,000 in + 1,200 out (gpt-5-mini) = **$0.00365 each** | | | | |
| Emails: 22 digests + 5 transactional per user/mo | 27 | 2.7k | 27k | 270k |
| DB size: about 12 KB/job (text + 1536-d vector). Matches: top 50/run kept 30 days | 0.2 GB | 1 GB | 4 GB | ~20 GB |

## C. Monthly estimate (USD)
| Line | 1 user | 100 | 1k | 10k | Basis |
|---|---|---|---|---|---|
| Supabase | 25 | 30 (Small) | 75 (Medium) | 127 (Large + 12 GB disk) | Prices A. Sizing [EI] |
| Vercel | 0 (personal dogfood) / 20 | 20 | ~40 | ~170 | Pro + **estimated** usage (UNCONFIRMED unit prices) |
| Cloudflare Workers + Queues | 5 | 5 | ~6 | ~10 | ≈80k msgs/day at 10k → 7.2M ops ≈ $2.5 + CPU ≈ $2 [EI] |
| Embeddings | 0.27 | 1.35 | 4.50 | 18 | churn × 30 × 1k tok × $0.02/M |
| Extraction | 2.63 | 13.16 | 43.88 | 175.50 | churn × 30 × $0.000195 |
| Explanations | 0.18 | 17.60 | 176 | 1,760 | users × $0.176 |
| Application prep | 0.07 | 2.20 | 22 | 219 | users × 6 × $0.00365 |
| Resend | 0 | 20 (100/day cap forces Pro) | 20 | 243 | Scale $90 + 170k × $0.90/1k |
| **Total (base)** | **≈ $33** (≈$8 on free tiers) | **≈ $109** | **≈ $387** | **≈ $2,723** | |
| **Per user** | $33 | $1.09 | $0.39 | **$0.27** | |
| Optional licensed data (Coresignal) | — | — | $199 (Starter) | $1,000 (Growth) | S16. Provenance check first |
| Per user incl. licensed data | — | — | $0.59 | $0.37 | |
One-time initial embedding of the corpus: $0.30 / $1.50 / $5 / $20.

## D. Sensitivities [EI]
- **Explanations dominate at scale (65% of the 10k total).** Levers: explain only the top 5 (−50%), cache per (user, job), use gpt-5-nano for bullets (about −80%), or use the Batch/Flex tiers (the same page lists lower-priced tiers at about half of standard, P16; check which tier fits).
- Corpus cost scales with **boards**, not users. Ten times the users with the same boards adds nothing to ingestion.
- Supabase Free is viable for a solo dogfood only if the inactivity pause doesn't trigger (cron activity counting as "activity" is UNCONFIRMED). Use Pro from Phase 2.
- ChatGPT Plus (Codex) is separate from OpenAI API billing. An API key with prepaid credit is required [AV].
