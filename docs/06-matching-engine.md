# 06 — Matching engine spec

Pipeline: **Hard filters → hybrid retrieval (lexical + embeddings, fused) → weighted interpretable score → explanation → feedback**. All of it is deterministic except the explanation text. [EI throughout unless tagged.]

## 1. Inputs
- **Profile** (`user_profiles`, `user_preferences`): target title families (e.g., "Account Executive", "Enterprise AE", "RevOps", "Sales Analyst", "BI Analyst"), seniority band, locations (e.g., DFW metro radius + Remote-US), workplace types, min base salary, employment types, work authorization, industries to prefer or avoid, resume text plus extracted skills.
- **Exclusions** (`exclusion_rules`): company blacklist, "do not reapply" companies (imported from the tracker column), keyword vetoes, staffing-agency veto, title vetoes.
- **Job** (`jobs` + extraction): normalized title, title family, seniority, location(s) with geo, workplace type, pay range (when present, as from Greenhouse `pay_input_ranges`, Lever `salaryRange` or Ashby compensation [VF S1–S3]), requirements list, posted/first-seen dates, status.

## 2. Stage A: hard filters (SQL, must be exact)
A job is excluded if **any** of these hold:
1. `jobs.status <> 'open'`, or `closed_at` is set, or `valid_through < now()`.
2. Company ∈ the user's blacklist or do-not-reapply list (matched on `company_id`, plus a normalized-name alias table).
3. An application already exists for (user, job), or for (user, company, title_family) within the cooldown (default 90 days).
4. Workplace/location mismatch: not remote-eligible for the user's country **and** outside the radius of every user location.
5. Pay ceiling known and `< user.min_base`. Unknown pay passes, flagged.
6. Employment type not accepted. Title matches a veto pattern. Seniority more than 1 band away.
7. Ashby `isListed=false` [VF S3]. Source marked `blocked` or terms not reviewed.

Output: the candidate set (expected ≤ 2,000 per user per day) [AV].

## 3. Stage B: hybrid retrieval
- **Lexical:** Postgres FTS over `title^A, requirements^B, description^C` with `ts_rank_cd` against a query built from title families and skills. Note: this is not true BM25 [EI]. A BM25 extension on Supabase is UNCONFIRMED, so evaluate it in Phase 3.
- **Semantic:** cosine similarity between `profile_embedding` (resume + targets) and `job_embedding` using `text-embedding-3-small` [VF P16]. Compute it **exactly over the filtered candidate set**, without an ANN index, to avoid pgvector's filtered-ANN short-return problem [DL P9].
- **Fusion:** Reciprocal Rank Fusion, `rrf = Σ 1/(60 + rank_i)`. Keep the top 200.

## 4. Stage C: weighted interpretable score (0–100)
| Component | Weight (default) | Computation |
|---|---|---|
| Title-family fit | 25 | Exact family = 1.0, adjacent = 0.6, else 0 |
| Requirements/skills coverage | 25 | Share of extracted must-haves evidenced in the resume (string + embedding match ≥0.8) |
| Semantic similarity | 15 | Cosine, min-max normalized within the candidate set |
| Compensation fit | 10 | 1.0 if range ≥ target. Linear down to the min. 0.5 if unknown |
| Location/workplace fit | 10 | Remote-eligible or in-radius = 1.0. Hybrid farther = 0.5 |
| Seniority fit | 10 | Same band = 1.0, ±1 = 0.5 |
| Freshness | 5 | 1.0 if first seen ≤ 3 days, decaying to 0 at 30 days |
Penalties: staffing agency −10, reposted more than 2× in 60 days −5, missing description −10. Score = Σ wᵢ·cᵢ − penalties, clipped to 0–100.
**Buckets:** ≥75 "Strong", 60–74 "Worth a look", <60 hidden from the digest (still visible in the app).

## 5. Explanations
- **Structured:** every match stores its `components` JSON, so the UI shows a bar per component.
- **Narrative:** `gpt-5-mini` produces at most 3 bullets ("Why it fits", "Gaps", "Watch-outs"). The input is only the structured components plus extracted evidence spans. Each bullet must quote a span from the JD or the resume. A post-check rejects any bullet whose quote is not a substring of the source text, and falls back to a template [EI].
- The LLM never changes the score.

## 6. Feedback loop
- **Signals:** 👍/👎 with reason chips (wrong role, wrong level, location, pay, company, already applied), shortlist, prepare, authorize, outcome (interview, offer, rejected).
- **Immediate:** a "company" or "already applied" reason creates an `exclusion_rules` row, which applies a hard filter next run.
- **Per-user weights:** after ≥50 labelled items, fit an L2-regularized logistic regression on the 7 components with weights constrained ≥0 and bounded at ±50% of the defaults. Store `matching_model_versions`. Roll back if precision@10 drops on the holdout.
- **Global:** a monthly review of reason-chip frequencies drives extraction and taxonomy fixes.

## 7. Evaluation plan
**Golden set (Phase 3):** 300 jobs drawn from real ingestion for Kwaku's profile. Kwaku labels each as relevant, maybe or no (about 45 min). Add positives from tracker rows with status Applied, Interviewing or Offer where the posting can be recovered, and hard negatives from blacklisted or do-not-reapply companies [AV: recoverability].
| Metric | Threshold to ship |
|---|---|
| Exclusion violations (blacklist, do-not-reapply, duplicate application, closed job) in any surfaced list | **= 0** (hard gate) |
| Precision@10 (relevant only) | ≥ 0.70 |
| nDCG@10 | ≥ 0.75 |
| Recall@50 of golden "relevant" | ≥ 0.80 |
| Calibration: 👍-rate in the "Strong" bucket vs "Worth a look" | Strong ≥ 0.65, Worth ≥ 0.35, monotonic. ECE ≤ 0.10 over 5 bins |
| Explanation grounding (quote found in source) | 100% of shown bullets |
| Latency: daily scoring per user | p95 ≤ 20 s |
Regression rule: any model or weight change must not lower precision@10 by more than 0.03 on the golden set and must keep violations at 0 (CI job `eval:matching`).
