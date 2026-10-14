# 04 — Competitive analysis (from vendors' own pages, accessed 2026-10-14)

| Product | Discovery | Matching | Apply model | Tracker | Price (own page) | Evidence |
|---|---|---|---|---|---|---|
| **Simplify** | Personalized job recommendations from user dealbreakers [VF C2] | Keyword score + missing keywords (free). Tailoring in Simplify+ [VF C1] | **Copilot browser extension autofills** on "100,000+ company career sites". The user clicks submit [VF C2] | Yes, free [VF C2] | Copilot free. Simplify+ **$19.99/wk, $39.99/mo, $89.99/3 mo** [VF C1] | C1, C2 |
| **Teal** | Job board + bookmarking [VF C3] | Resume ↔ JD match score [VF C3] | Autofill feature [VF C3] | Unlimited job tracking (free) [VF C3] | Free. Teal+ **$13/7 days, $29/30 days, $79/90 days** [VF C3] | C3 |
| **Huntr** | Basic job matching (free) [VF C4] | Basic resume scoring (free). AI tailoring (Pro) [VF C4] | Unlimited application autofills via Chrome extension [VF C4] | Job, contact and interview trackers [VF C4] | Free. Pro **$40/mo, $90/3 mo, $160/6 mo** [VF C4] | C4 |
| **LoopCV** | "Scans 30+ job boards daily" [VF C5] | Matches roles to the CV [VF C5] | **Auto-apply: "submits applications on your behalf automatically"** [VF C5] | Yes [VF C5] | Free. Paid **from €9.99/mo** [VF C5] | C5 |
| **Jobright** | Own blog claims "400K new jobs/day" [VF C6, claim not audited] | AI matching + Orion assistant [VF C6] | Autofill extension (blog) [VF C6] | Yes (blog) [VF C6] | Blog states **Free / $29.99/mo**. The same post also says $19.99, and another post says $30. **No official pricing page found (404) → current price UNCONFIRMED** | C6 |
| **HiringCafe** | Kwaku's current saved search. Jobright's blog describes it as "scraped, verified postings only" | — | Links out | — | Free per Jobright's blog → **UNCONFIRMED** (own terms page 403) | C6 (secondary) |

## Where Jobr wins [EI]
1. **Trust over volume.** LoopCV markets auto-apply on the user's behalf [VF C5]. Jobr's per-submission authorization is a deliberate counter-position for candidates who care about quality and reputation, which is exactly the problem Jobber solves for Kwaku today.
2. **Provenance and freshness.** Every listing is linked to an ATS-direct source with `first_seen`, `last_seen` and `closed_at`. Most competitors don't show this [AV: verify competitors' freshness claims by test].
3. **Explainable, exclusion-safe ranking.** Component scores, evidence quotes, and a hard guarantee that blacklisted or "do not reapply" companies never appear (validation V3).
4. **Honest status.** "Submitted (unverified)" vs "Submitted (confirmed by email)". No competitor page I read describes this [EI].
5. **Daily digest as the product surface.** Jobber's weekday review becomes a 2-minute email/PWA ritual.

## Where Jobr loses (be explicit)
- No autofill extension at MVP (Simplify, Huntr and Teal have one). Coverage is narrower than aggregators until the licensed-data phase. No brand. [EI]

## Pricing implication [AV]
The market clusters at **$29–40/mo** for premium tiers (Simplify $39.99, Huntr $40, Teal ≈$29/30 days). Jobr's marginal cost is about $0.27–0.37/user/mo at 10k users (file 11), so pricing is a positioning decision, not a cost decision. Defer it until cohort data exists.
