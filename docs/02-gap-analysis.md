# 02 — Expert gap analysis (7 perspectives)

The reference workflow (Jobber) is a weekday agent that reads Gmail job emails and a saved HiringCafe search, flags blacklisted and already-applied companies, and writes to a Google Sheet. Productizing it exposes the gaps below.

## Architect
| Gap | Why it matters | Resolution |
|---|---|---|
| No canonical job identity across sources | The same role shows up in a HiringCafe email, on Greenhouse, and in an aggregator | `jobs` canonical row + `job_sources` many-to-one. Key = (ATS, board, external_id), with a fuzzy fallback on (company, normalized title, location) [EI] |
| Company-scoped ATS APIs | No search endpoint exists. You must know each board token [VF S1–S4] | `companies` + `company_boards` registry, seeded from the tracker, alert emails and user-pasted URLs [EI] |
| Long batch jobs vs serverless caps | Vercel caps at 300 s (Hobby) / 800 s (Pro). Supabase Edge allows 2 s CPU [DL P2, P8] | Fan out one queue message per board on Cloudflare Queues [VF P13] |
| Agent-shaped logic in a SaaS | Jobber logic lives in prompts | Deterministic pipeline. LLMs only for extraction, explanations and drafting, behind schemas [EI] |

## ML / ranking
| Gap | Resolution |
|---|---|
| No labelled data | Bootstrap from the tracker's 141 outcomes (Applied/Interviewing/Offer as positives, Blacklisted/"Do not reapply" as hard negatives) plus 300 hand-labelled jobs [AV: labels usable] |
| Opaque LLM scoring | Weighted, component-level score. The LLM writes the explanation, never the score (file 06) [EI] |
| pgvector + filters return short lists | Documented by Supabase [DL P9]. Use exact cosine over the hard-filtered candidate set (small per user), no ANN index in the MVP [EI] |
| Postgres FTS ≠ BM25 | `ts_rank_cd` is not BM25 [EI]. BM25 extension availability on Supabase is UNCONFIRMED, so ship FTS-ranked lexical scoring first and benchmark |

## Recruiting tech
| Gap | Resolution |
|---|---|
| Expiry detection | Jobs vanish from board JSON when closed. Mark `closed_at` after 2 consecutive misses. Honour `validThrough` from JSON-LD [VF S7, EI] |
| Reposts and evergreen reqs | Track `first_seen_at`, repost lineage, and Greenhouse `first_published` / Ashby `publishedAt` [VF S1, S3] |
| Duplicate applications | DB-level uniqueness per (user, job) and per (user, company, title family) within 90 days, plus "do not reapply" (file 07) |
| Application forms vary per job | Greenhouse exposes per-job `questions` and compliance/EEOC/demographic questions [VF S1]. Use them to *prepare* answers. Demographic answers stay user-entered only |

## Security
| Gap | Resolution |
|---|---|
| Resume and PII in a multi-tenant DB | Supabase RLS on every user table, private Storage bucket, signed URLs, column-level care for phone and address [EI] |
| Inbox access | Avoid Gmail restricted scopes (CASA) [DL P19]. Use the forwarding alias. Sanitize inbound HTML. Treat email content as untrusted (prompt-injection boundary) |
| Unauthorized submission | Submission requires a single-use, short-TTL authorization record bound to a hash of the exact package. No code path submits without it (file 08, test V6) |
| Secrets | Service-role key only in Workers/server. Never in the client. Rotate quarterly [EI] |

## PM
| Gap | Resolution |
|---|---|
| Unclear wedge vs. Simplify/Jobright | Wedge: trustworthy curation. Genuine, fresh, ATS-direct listings, explainable ranking, zero-exclusion guarantee, and honest status (file 04) [EI] |
| Single-user origin | Phase the product: dogfood with Kwaku (M1–M3), then a 10–20 user cohort, then self-serve [AV] |
| Pricing undecided | Defer until the cohort's retention data exists. Competitors sit at $29–40/mo [VF C1, C3, C4] |

## DevOps
| Gap | Resolution |
|---|---|
| Scheduler reliability is unobservable today | `source_runs` + `digest_runs` tables, heartbeat alert if no successful run in 26 h, dead-letter queue [VF P13 DLQ] |
| Agent tooling instability | Repo root with `AGENTS.md`, single package root, CI as the source of truth. Codex Web project-root bug workaround in file 09 [VF T1] |
| Environments | Supabase dev + prod projects. Vercel preview deploys. Wrangler environments [EI] |

## QA
| Gap | Resolution |
|---|---|
| No golden data | Recorded ATS fixtures (JSON snapshots), golden ranking set, seeded RLS test users |
| Hard guarantees untested | Property tests for exclusion = 0, authorization gating, uniqueness. Contract tests per connector. Tenant-isolation tests with two JWTs (file 14) |

## Decide now vs. defer
| Decide now (blocks Phase 1–2) | Recommended | Defer (no blocker before Phase 6+) |
|---|---|---|
| Job-source policy: official public APIs + user-forwarded email + user-pasted URLs only. No LinkedIn/Indeed/ZipRecruiter scraping, no Workday internal JSON | Yes | Licensed aggregator (Coresignal/Adzuna commercial) |
| Submission model: prepare → authorize → user submits on the employer page | Yes | Browser extension for assisted autofill |
| Stack: Next.js/Vercel + Supabase + Cloudflare Workers | Yes | Moving UI to Cloudflare (OpenNext) |
| Email lane via forwarding alias (no Gmail OAuth) | Yes | Gmail/Outlook OAuth (CASA cost) |
| Domain name for inbound mail and the app | Kwaku picks | Billing/Stripe, pricing |
| Embedding model + dimension (1536, text-embedding-3-small) | Yes (changing later means a re-embed) | BM25 extension, learned-to-rank |
| First user = Kwaku. Tracker import from his Sheet | Yes | Mobile native app (ship PWA first) |
