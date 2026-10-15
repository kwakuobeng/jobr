# Tier-1 Job Source Recorded Fixtures (`tier1_fixtures.json`)

This directory contains schema-verified JSON payloads for Jobr's four Tier-1 public `GET` discovery providers. Each provider key (`greenhouse`, `ashby`, `lever`, `usajobs`) contains 3 real-shape job records conforming to the official primary API specifications below:

1. **Greenhouse Job Board API (`greenhouse`)**
   - **Primary Documentation URL**: https://docs.greenhouse.io/job-board.html
   - **Endpoint Pattern**: `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true`
   - **Included Test Cases**:
     - `4918273`: Senior Distributed Systems Engineer (Stripe) — includes `pay_input_ranges` (`min_cents`, `max_cents`), `data_compliance` (GDPR flags), and `include_ai_disclaimer`.
     - `4918274`: Staff Security Engineer, Identity (Cloudflare) — Remote US with `pay_input_ranges`.
     - `4918275`: Product Designer, Developer Experience (Figma) — Undisclosed compensation (`pay_input_ranges` omitted).

2. **Ashby Public Job Postings API (`ashby`)**
   - **Primary Documentation URL**: https://developers.ashbyhq.com/docs/public-job-posting-api
   - **Endpoint Pattern**: `GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}?includeCompensation=true`
   - **Included Test Cases**:
     - `ashby-linear-001`: Staff Platform Engineer (Linear) — `isListed: true`, `workplaceType: "Remote"`, `secondaryLocations`, and structured `Salary` + `EquityPercentage` `summaryComponents`.
     - `ashby-supabase-002`: Database Kernel Engineer (Supabase) — `isListed: true`, `workplaceType: "Remote"`.
     - `ashby-unlisted-003`: Internal Executive Operations Lead — **`isListed: false`** (verifies that the ingestion normalizer filters out unlisted internal postings per Ashby's API documentation).

3. **Lever Postings API (`lever`)**
   - **Primary Documentation URL**: https://github.com/lever/postings-api
   - **Endpoint Pattern**: `GET https://api.lever.co/v0/postings/{SITE}?mode=json`
   - **Included Test Cases**:
     - `lever-plaid-901`: Principal Backend Engineer, Payments (Plaid) — includes `salaryRange` (`min`, `max`, `currency`, `interval`), `workplaceType: "hybrid"`, and `lists`.
     - `lever-palantir-902`: Forward Deployed Software Engineer (Palantir) — `workplaceType: "on-site"` with `salaryRange`.
     - `lever-mistral-903`: Research Engineer, Inference Optimization (Mistral AI) — `workplaceType: "remote"`, undisclosed `salaryRange`.

4. **USAJOBS Official Search API (`usajobs`)**
   - **Primary Documentation URL**: https://developer.usajobs.gov/api-reference/get-api-search
   - **Endpoint Pattern**: `GET https://data.usajobs.gov/api/search` (requires `Authorization-Key` and `User-Agent` request headers).
   - **Included Test Cases**:
     - `USDS-2026-109482`: IT Specialist (GS-15) — **Remote (`RemoteIndicator: true`, `TeleworkEligible: true`, `"Anywhere in the U.S. (Remote)"`)** with annualized `PositionRemuneration` (`RateIntervalCode: "PA"`).
     - `CISA-2026-204910`: Cybersecurity Engineering Specialist (GS-14) — Arlington, VA (`TeleworkEligible: true`).
     - `NASA-2026-308115`: Computer Scientist (GS-14) — Houston, TX.
