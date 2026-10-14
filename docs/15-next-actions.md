# 15 — Immediate next actions and first demoable milestone

## Next actions (this week)
| # | Action | Owner | Output |
|---|---|---|---|
| 1 | Approve the **decide-now** table (file 02): source policy, submission model, stack, email alias, embedding model | Kwaku | `docs/decisions.md` |
| 2 | Pick a product domain (needed for the inbound alias `in.<domain>` on Cloudflare and for Resend sending) | Kwaku | Domain registered in Cloudflare |
| 3 | Create a private GitHub repo `kwakuobeng/jobr`, commit `docs/blueprint/` (these files) | Grok Bot (GitHub connector) after Kwaku approves | Repo + PR |
| 4 | Create Supabase dev project (Pro when Phase 2 starts), Cloudflare Workers Paid ($5), and an OpenAI API key with a prepaid budget cap | Kwaku | Credentials in a secret store, never in chat |
| 5 | Run Prompt A (Gemini) to close UNCONFIRMED items. Run Prompt B (Claude) on files 05–08 | Kwaku (human relay) | PRs `research/*`, `reviews/*` |
| 6 | Codex: J-01 → J-10 (Foundations). Smoke-test the Codex Web environment first (file 09 mitigation) | Codex / Kwaku | Green CI |
| 7 | Export the tracker Sheet to CSV and list 150–300 target companies (seed from the tracker + recent HiringCafe emails) | Kwaku + Grok Bot | `seed/companies.csv` |
| 8 | Label 300 golden-set jobs once Phase 2 ingests (≈45 min) | Kwaku | `eval/golden.jsonl` |

## First independently demoable milestone: **M1 "Live ATS feed, ranked for Kwaku"** (end of Phase 2 + Phase 3 minimal)
**Demo:** on a scheduled weekday run, Jobr ingests ≥100 real companies from Greenhouse, Lever, Ashby and SmartRecruiters into Supabase. It dedupes and expires correctly and shows Kwaku a ranked list (simple web page or a CSV export) for his AE/RevOps profile, with component scores and a source link per job.

**Pass criteria (measurable):**
- ≥100 boards, ≥98% board success on 3 consecutive weekday runs (V8 subset).
- V1a ≥98% genuine on a 50-job sample. V1c = 0 compliance violations.
- **V3 = 0** exclusion violations against his blacklist, do-not-reapply list and the 141 imported applications.
- V4b: removed fixture jobs close within 2 runs.
- Kwaku rates the top 20: ≥12 "relevant" (P@20 ≥ 0.6 as an early bar, before the full golden set).

M1 needs no UI polish, no email, and no application flow. It proves the hardest dependency (acquisition) and the core value (relevance) independently of everything else.
