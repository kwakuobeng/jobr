# M1.1 verification handoff — 2026-10-14

Branch: `feat/m1-1-foundation`. Existing PR #1 is extended; no merge is authorized by this handoff.

| Check | Local result |
| --- | --- |
| `pnpm typecheck` | PASS: strict TypeScript, no unchecked indexed access |
| `pnpm lint` | PASS: zero warnings |
| Source scan for `any` types / `@ts-ignore` | PASS: no matches in source or TypeScript specs |
| `pnpm test:unit` | PASS: 154 / 154 tests across 7 files, including mocked adapter and deterministic security suites |
| Resume + ingestion coverage | PASS: statements 99.71%, branches 98.68%, functions 98.82%, lines 100% |
| `pnpm build` | PASS: Next.js production build |
| `supabase db reset --local` with version 16 | BLOCKED: CLI rejects `db.major_version = 16` |
| `supabase db reset --local` with existing version 17 | BLOCKED: `LocalDbRunningError`, failed to inspect service |
| `supabase test db` | BLOCKED: `ECONNREFUSED 127.0.0.1:54322`; no running local stack |
| Five live public boards | BLOCKED: all 5 fail DNS `EAI_AGAIN` for public ATS hosts |
| Playwright browser installation | BLOCKED: CDN downloads are invalid/truncated ZIPs; browser tests not executed |

These are results from this implementation session, not inherited claims from earlier PR text.
The existing pgTAP file is retained; eight hybrid-RPC tests are added. Neither suite is claimed
as passed here. CI now has checks, browser and real Supabase database jobs, whose results
must be reviewed before merge. PostgreSQL 16 compatibility is separately unverified because
the CLI's supported local configuration retains PostgreSQL 17.

The supplied `0002_hybrid_search_rpc.sql` becomes migration `0004_hybrid_search_rpc.sql`
to preserve the existing `0002` ownership/PostGIS security hardening and the planned storage
slot. The hybrid RPC is SECURITY INVOKER, revokes PUBLIC/anon execution, bounds parameters,
and explicitly orders both retrieval subsets before limiting them. An owned-profile smoke
query checks that the function executes against the migrated schema when database CI runs.

The supplied provider fixtures are synthetic; no real-world captured fixture or working
live-board connection is claimed. Direct ATS membership verifies Greenhouse/Ashby/Lever
listing status. USAJOBS uses its authenticated API without following redirects. JSON-LD
fetching runs only through the guarded HTTPS client and never executes page scripts.

The 25 malicious prompt strings exercise escaping, strict contract rejection and deterministic
post-processing. They are not live model prompt-injection evaluations. Citation substring
validation proves textual provenance, not semantic entailment of a generated claim. Human
review of all draft facts, questions and employer consents remains mandatory. Submission,
authenticated product screens, persistence workers, and end-to-end matching quality are later
milestones. The deduplicator returns a pure state/decision; transactional SQL persistence and
scheduler concurrency must be integrated before production ingestion.

Grok gate: pending. Keep the PR unmerged until database results, PostgreSQL version alignment,
and adversarial review are resolved.
