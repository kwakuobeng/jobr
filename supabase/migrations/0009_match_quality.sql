-- 0009: match quality (Kwaku-approved fix sequence, 2026-10-15). Additive; 0001-0008 are not edited.
--   1. Embeddings: 768-dim vectors for Workers AI @cf/baai/bge-base-en-v1.5 (free tier, D8).
--      Both embedding columns were never populated (0 rows on hosted), so the type change loses nothing.
--   2. Region/country stored per job (canonical_jobs.region, country_codes); the RPC filters on it
--      before the top-N cut. Values come from src/lib/jobs/region.ts (ingestion + backfill).
--   3. Per-office duplicate postings merge into one keeper row (duplicate_of), locations unioned.
--   4. Per-employer diversification in match_jobs_hybrid.
--   5. Title-weighted lexical rank (title 1.0 vs description 0.02).
--   + ingest_job_batch / merge_duplicate_postings / close_stale_jobs for the Cron+Queue ingest worker (D6).

-- ---------------------------------------------------------------------------
-- 1. Embedding columns → vector(768)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_canonical_jobs_active_hnsw;
ALTER TABLE public.canonical_jobs ALTER COLUMN requirements_embedding TYPE vector(768) USING NULL;
ALTER TABLE public.candidate_profiles ALTER COLUMN target_job_embedding TYPE vector(768) USING NULL;
CREATE INDEX idx_canonical_jobs_active_hnsw ON public.canonical_jobs
  USING hnsw (requirements_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE status = 'active';

ALTER TABLE public.canonical_jobs
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_source_hash TEXT,
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS region TEXT CHECK (region IS NULL OR region IN ('us', 'non_us', 'unknown')),
  ADD COLUMN IF NOT EXISTS country_codes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES public.canonical_jobs(id) ON DELETE SET NULL,
  ADD CONSTRAINT canonical_jobs_not_self_duplicate CHECK (duplicate_of IS NULL OR duplicate_of <> id);
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS target_embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS target_embedding_source_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_canonical_jobs_region ON public.canonical_jobs (region) WHERE status = 'active' AND duplicate_of IS NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_jobs_office_merge
  ON public.canonical_jobs (canonical_employer_id, normalized_title_slug, employment_type)
  WHERE status = 'active' AND duplicate_of IS NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_jobs_needs_embedding ON public.canonical_jobs (first_discovered_at)
  WHERE status = 'active' AND duplicate_of IS NULL AND requirements_embedding IS NULL;

-- ---------------------------------------------------------------------------
-- 2-5. match_jobs_hybrid: new optional args (region filters, employer cap). The old 5-arg
-- overload is dropped so there is exactly one function; existing 5-arg named calls still resolve.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.match_jobs_hybrid(UUID, TEXT, BOOLEAN, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.match_jobs_hybrid(
  p_candidate_profile_id UUID,
  p_query_text TEXT DEFAULT '',
  p_include_stretch_exceptions BOOLEAN DEFAULT false,
  p_rrf_k INTEGER DEFAULT 60,
  p_top_n INTEGER DEFAULT 50,
  p_region TEXT DEFAULT 'all',
  p_us_or_remote_only BOOLEAN DEFAULT false,
  p_max_per_employer INTEGER DEFAULT 3
)
RETURNS TABLE (
  canonical_job_id UUID,
  identity_hash TEXT,
  title TEXT,
  employer_name TEXT,
  workplace_type workplace_mode_type,
  employment_type employment_commitment_type,
  seniority_level seniority_level_type,
  min_annual_salary_usd INTEGER,
  max_annual_salary_usd INTEGER,
  is_salary_estimated BOOLEAN,
  locations_json JSONB,
  extracted_required_skills TEXT[],
  extracted_preferred_skills TEXT[],
  extracted_tech_slugs TEXT[],
  min_years_experience NUMERIC(4,1),
  max_years_experience NUMERIC(4,1),
  canonical_posting_url TEXT,
  application_url TEXT,
  application_mode_supported TEXT,
  semantic_similarity DOUBLE PRECISION,
  lexical_rank DOUBLE PRECISION,
  rrf_score DOUBLE PRECISION,
  region TEXT,
  country_codes TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_target_embedding vector(768);
  v_excluded_employer_ids UUID[];
  v_excluded_tech_slugs TEXT[];
  v_allowed_workplace_types workplace_mode_type[];
  v_allowed_employment_types employment_commitment_type[];
  v_hard_min_salary INTEGER;
  v_allow_undisclosed_salary BOOLEAN;
  v_requires_visa BOOLEAN;
  v_home_geo extensions.geography(Point, 4326);
  v_max_commute_meters DOUBLE PRECISION;
  v_excluded_domains TEXT[];
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated call to match_jobs_hybrid' USING ERRCODE = '42501';
  END IF;

  IF p_rrf_k IS NULL OR p_rrf_k < 1 OR p_top_n IS NULL OR p_top_n < 1 OR p_top_n > 50
     OR p_region IS NULL OR p_region NOT IN ('all', 'us', 'non_us', 'unknown')
     OR p_us_or_remote_only IS NULL
     OR p_max_per_employer IS NULL OR p_max_per_employer < 1 OR p_max_per_employer > 50 THEN
    RAISE EXCEPTION 'Invalid hybrid query limits' USING ERRCODE = '22023';
  END IF;

  -- 1. Load candidate profile & preferences (enforced via RLS on candidate_profiles & job_preferences)
  SELECT
    cp.user_id,
    cp.target_job_embedding,
    COALESCE(jp.excluded_employer_ids, '{}'),
    COALESCE(jp.excluded_tech_slugs, '{}'),
    COALESCE(ARRAY(SELECT lower(btrim(d)) FROM unnest(jp.excluded_employer_domains) d WHERE btrim(d) <> ''), '{}'),
    COALESCE(jp.allowed_workplace_types, '{remote,hybrid,onsite}'),
    COALESCE(jp.allowed_employment_types, '{full_time}'),
    jp.hard_min_annual_salary_usd,
    COALESCE(jp.allow_undisclosed_salary, true),
    COALESCE(jp.requires_visa_sponsorship, false),
    jp.home_geo_point,
    CASE WHEN jp.max_commute_miles IS NOT NULL THEN jp.max_commute_miles * 1609.344 ELSE NULL END
  INTO
    v_user_id,
    v_target_embedding,
    v_excluded_employer_ids,
    v_excluded_tech_slugs,
    v_excluded_domains,
    v_allowed_workplace_types,
    v_allowed_employment_types,
    v_hard_min_salary,
    v_allow_undisclosed_salary,
    v_requires_visa,
    v_home_geo,
    v_max_commute_meters
  FROM public.candidate_profiles cp
  LEFT JOIN public.job_preferences jp ON jp.candidate_profile_id = cp.id
  WHERE cp.id = p_candidate_profile_id
    AND cp.user_id = (SELECT auth.uid());

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Candidate profile % not found or unauthorized', p_candidate_profile_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH eligible_jobs AS (
    -- STAGE 1: Deterministic Hard-Constraint Gate
    SELECT
      cj.id,
      cj.identity_hash,
      cj.title,
      cj.employer_name,
      cj.workplace_type,
      cj.employment_type,
      cj.seniority_level,
      cj.min_annual_salary_usd,
      cj.max_annual_salary_usd,
      cj.is_salary_estimated,
      cj.locations_json,
      cj.extracted_required_skills,
      cj.extracted_preferred_skills,
      cj.extracted_tech_slugs,
      cj.min_years_experience,
      cj.max_years_experience,
      cj.canonical_posting_url,
      cj.application_url,
      cj.application_mode_supported,
      cj.requirements_embedding,
      cj.search_tsv,
      cj.canonical_employer_id,
      COALESCE(cj.region, 'unknown') AS region,
      COALESCE(cj.country_codes, '{}') AS country_codes,
      COALESCE(cj.original_published_at, cj.first_discovered_at) AS recency_at
    FROM public.canonical_jobs cj
    WHERE cj.status = 'active'
      -- 0009: per-office copies are merged into one keeper row; copies are never ranked.
      AND cj.duplicate_of IS NULL
      -- 0009: user location filters run here, before ranking and the top-N cut (not stretch-relaxable).
      AND (p_region = 'all' OR COALESCE(cj.region, 'unknown') = p_region)
      AND (
        p_us_or_remote_only = false
        OR COALESCE(cj.region, 'unknown') = 'us'
        OR (cj.workplace_type = 'remote' AND COALESCE(cj.region, 'unknown') = 'unknown')
      )
      AND cj.ghost_risk_score < 0.75
      -- Suppress any job/identity_hash already decided or applied by this user
      AND NOT EXISTS (
        SELECT 1 FROM public.recommendation_decisions rd
        WHERE rd.user_id = v_user_id
          AND (rd.canonical_job_id = cj.id OR rd.identity_hash = cj.identity_hash)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.applications app
        WHERE app.user_id = v_user_id
          AND app.canonical_job_id = cj.id
      )
      -- Hard exclusions (applied unless p_include_stretch_exceptions is true)
      AND (
        p_include_stretch_exceptions = true
        OR (
          NOT (cj.canonical_employer_id = ANY(v_excluded_employer_ids))
          AND NOT (cj.extracted_tech_slugs && v_excluded_tech_slugs)
          AND (
            cardinality(v_excluded_domains) = 0
            OR NOT EXISTS (
              SELECT 1
              FROM unnest(v_excluded_domains) AS d(dom)
              LEFT JOIN public.canonical_employers ce ON ce.id = cj.canonical_employer_id
              CROSS JOIN LATERAL (
                SELECT lower(substring(cj.canonical_posting_url FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#]+)')) AS host
              ) h
              WHERE lower(ce.primary_domain) = d.dom
                 OR h.host = d.dom
                 OR right(h.host, length(d.dom) + 1) = '.' || d.dom
            )
          )
          AND (cj.workplace_type = ANY(v_allowed_workplace_types) OR cj.workplace_type = 'unspecified')
          AND (cj.employment_type = ANY(v_allowed_employment_types))
          AND (
            v_hard_min_salary IS NULL
            OR COALESCE(cj.max_annual_salary_usd, cj.min_annual_salary_usd) >= v_hard_min_salary
            OR (cj.max_annual_salary_usd IS NULL AND cj.min_annual_salary_usd IS NULL AND v_allow_undisclosed_salary = true)
          )
          AND (
            v_requires_visa = false
            OR cj.visa_sponsorship_policy <> 'explicit_no'
          )
          AND (
            cj.workplace_type = 'remote'
            OR v_home_geo IS NULL
            OR v_max_commute_meters IS NULL
            OR cj.primary_geo_point IS NULL
            OR extensions.ST_DWithin(cj.primary_geo_point, v_home_geo, v_max_commute_meters)
          )
        )
      )
  ),
  semantic_top AS (
    -- STAGE 2A: Dense vector retrieval. Only jobs with a real embedding on both sides take part;
    -- with no candidate embedding this leg is empty (0006: no more id-order pseudo-ranks).
    SELECT
      ej.id,
      (1.0 - (ej.requirements_embedding <=> v_target_embedding))::DOUBLE PRECISION AS sem_sim,
      ROW_NUMBER() OVER (
        ORDER BY (ej.requirements_embedding <=> v_target_embedding) ASC, ej.id ASC
      ) AS sem_rank
    FROM eligible_jobs ej
    WHERE v_target_embedding IS NOT NULL
      AND ej.requirements_embedding IS NOT NULL
    ORDER BY sem_rank
    LIMIT 200
  ),
  lexical_query AS (
    -- NULLIF keeps an empty query from being parsed at all (strict function -> NULL).
    SELECT x.q FROM (SELECT websearch_to_tsquery('english', NULLIF(btrim(p_query_text), '')) AS q) x
    WHERE x.q IS NOT NULL
  ),
  lexical_top AS (
    -- STAGE 2B: Full-text retrieval. Only real matches (search_tsv @@ query, ts_rank_cd > 0) are ranked;
    -- non-matching jobs no longer receive a lexical rank (0006).
    SELECT
      m.id,
      m.lex_score,
      ROW_NUMBER() OVER (ORDER BY m.lex_score DESC, m.id ASC) AS lex_rank
    FROM (
      SELECT ej.id, ts_rank_cd('{0.0, 0.02, 0.1, 1.0}'::real[], ej.search_tsv, lq.q)::DOUBLE PRECISION AS lex_score
      FROM eligible_jobs ej
      CROSS JOIN lexical_query lq
      WHERE ej.search_tsv @@ lq.q
    ) m
    WHERE m.lex_score > 0
    ORDER BY lex_rank
    LIMIT 200
  ),
  recency_fallback AS (
    -- STAGE 2C: Used only when neither retrieval leg produced anything
    -- (no embedding and no lexical match): newest eligible jobs first.
    SELECT
      ej.id,
      ROW_NUMBER() OVER (ORDER BY ej.recency_at DESC NULLS LAST, ej.id ASC) AS rec_rank
    FROM eligible_jobs ej
    WHERE NOT EXISTS (SELECT 1 FROM semantic_top)
      AND NOT EXISTS (SELECT 1 FROM lexical_top)
    ORDER BY rec_rank
    LIMIT 200
  ),
  rrf_combined AS (
    -- STAGE 2D: Reciprocal Rank Fusion over the legs that actually apply.
    SELECT
      COALESCE(s.id, l.id) AS job_id,
      COALESCE(s.sem_sim, 0.0) AS sem_sim,
      COALESCE(l.lex_score, 0.0) AS lex_score,
      (
        COALESCE(1.0 / (p_rrf_k + s.sem_rank), 0.0) +
        COALESCE(1.0 / (p_rrf_k + l.lex_rank), 0.0)
      )::DOUBLE PRECISION AS fused_rrf
    FROM semantic_top s
    FULL OUTER JOIN lexical_top l ON s.id = l.id
    UNION ALL
    SELECT r.id, 0.0::DOUBLE PRECISION, 0.0::DOUBLE PRECISION, (1.0 / (p_rrf_k + r.rec_rank))::DOUBLE PRECISION
    FROM recency_fallback r
  ),
  diversified AS (
    -- STAGE 3 (0009): per-employer diversification. Each employer contributes at most
    -- p_max_per_employer rows per round; rounds are ordered by score, so the list still fills.
    SELECT
      rc.job_id, rc.sem_sim, rc.lex_score, rc.fused_rrf,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(ej.canonical_employer_id::text, lower(ej.employer_name))
        ORDER BY rc.fused_rrf DESC, rc.sem_sim DESC, rc.job_id ASC
      ) AS employer_rank
    FROM rrf_combined rc
    JOIN eligible_jobs ej ON ej.id = rc.job_id
  )
  SELECT
    ej.id AS canonical_job_id,
    ej.identity_hash,
    ej.title,
    ej.employer_name,
    ej.workplace_type,
    ej.employment_type,
    ej.seniority_level,
    ej.min_annual_salary_usd,
    ej.max_annual_salary_usd,
    ej.is_salary_estimated,
    ej.locations_json,
    ej.extracted_required_skills,
    ej.extracted_preferred_skills,
    ej.extracted_tech_slugs,
    ej.min_years_experience,
    ej.max_years_experience,
    ej.canonical_posting_url,
    ej.application_url,
    ej.application_mode_supported,
    d.sem_sim AS semantic_similarity,
    d.lex_score AS lexical_rank,
    d.fused_rrf AS rrf_score,
    ej.region,
    ej.country_codes
  FROM diversified d
  JOIN eligible_jobs ej ON ej.id = d.job_id
  ORDER BY ((d.employer_rank - 1) / p_max_per_employer) ASC, d.fused_rrf DESC, d.sem_sim DESC, ej.id ASC
  LIMIT p_top_n;
END;
$$;
REVOKE ALL ON FUNCTION public.match_jobs_hybrid(UUID, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_jobs_hybrid(UUID, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT, BOOLEAN, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- Region helper shared by ingestion and merging: same rule as classifyLocations() in TS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.region_from_country_codes(p_codes TEXT[])
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN 'US' = ANY (COALESCE(p_codes, '{}')) THEN 'us'
              WHEN cardinality(COALESCE(p_codes, '{}')) > 0 THEN 'non_us'
              ELSE 'unknown' END;
$$;

-- Distinct union of two JSON arrays of locations, original order kept.
CREATE OR REPLACE FUNCTION public.jsonb_array_union(a JSONB, b JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(v ORDER BY o), '[]'::jsonb) FROM (
    SELECT DISTINCT ON (v) v, o FROM (
      SELECT v, o FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a) = 'array' THEN a ELSE '[]' END) WITH ORDINALITY x(v, o)
      UNION ALL
      SELECT v, o + 100000 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b) = 'array' THEN b ELSE '[]' END) WITH ORDINALITY y(v, o)
    ) u ORDER BY v, o
  ) d;
$$;

-- ---------------------------------------------------------------------------
-- 3. Merge existing per-office duplicates: same employer + normalized title + employment type.
-- Keeper = earliest discovered. Locations and country codes are unioned onto the keeper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_duplicate_postings()
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE g RECORD; v_merged INTEGER := 0;
BEGIN
  FOR g IN
    SELECT (array_agg(cj.id ORDER BY cj.first_discovered_at, cj.id))[1] AS keeper_id,
           (array_agg(cj.id ORDER BY cj.first_discovered_at, cj.id))[2:] AS dup_ids
    FROM public.canonical_jobs cj
    WHERE cj.status = 'active' AND cj.duplicate_of IS NULL AND cj.canonical_employer_id IS NOT NULL
    GROUP BY cj.canonical_employer_id, cj.normalized_title_slug, cj.employment_type
    HAVING count(*) > 1
  LOOP
    UPDATE public.canonical_jobs k SET
      locations_json = (SELECT COALESCE(jsonb_agg(v ORDER BY o), '[]'::jsonb) FROM (
          SELECT DISTINCT ON (e.v) e.v, e.o FROM (
            SELECT x.v, (c.first_discovered_at, c.id, x.o) AS o
            FROM public.canonical_jobs c
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.locations_json) = 'array' THEN c.locations_json ELSE '[]' END) WITH ORDINALITY x(v, o)
            WHERE c.id = g.keeper_id OR c.id = ANY (g.dup_ids)) e
          ORDER BY e.v, e.o) d),
      country_codes = ARRAY(SELECT DISTINCT x FROM public.canonical_jobs c, unnest(c.country_codes) x
                            WHERE c.id = g.keeper_id OR c.id = ANY (g.dup_ids) ORDER BY x),
      last_seen_at = (SELECT max(c.last_seen_at) FROM public.canonical_jobs c WHERE c.id = g.keeper_id OR c.id = ANY (g.dup_ids))
    WHERE k.id = g.keeper_id;
    UPDATE public.canonical_jobs SET region = public.region_from_country_codes(country_codes) WHERE id = g.keeper_id;
    UPDATE public.canonical_jobs SET duplicate_of = g.keeper_id WHERE id = ANY (g.dup_ids);
    v_merged := v_merged + cardinality(g.dup_ids);
  END LOOP;
  RETURN v_merged;
END;
$$;

-- ---------------------------------------------------------------------------
-- Ingestion writer for the Cron+Queue worker (D6). One call per source page.
-- p_jobs: [{external_id, employer_name, employer_slug, employer_domain, title, title_slug,
--   locations, workplace, employment, min_usd, max_usd, currency, description, simhash,
--   posting_url, apply_url, published_at, raw_hash, country_codes}]
-- Idempotent: a redelivered page only refreshes last_seen/last_polled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_job_batch(p_job_source_id UUID, p_jobs JSONB)
RETURNS TABLE (inserted INTEGER, merged INTEGER, updated INTEGER)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_provider TEXT; v_tenant TEXT;
  v_employer UUID; v_job UUID; v_old_hash TEXT;
  v_ins INTEGER := 0; v_mer INTEGER := 0; v_upd INTEGER := 0;
BEGIN
  SELECT provider_type, tenant_slug INTO v_provider, v_tenant FROM public.job_sources WHERE id = p_job_source_id;
  IF v_provider IS NULL THEN RAISE EXCEPTION 'unknown job source %', p_job_source_id USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_jobs) <> 'array' OR jsonb_array_length(p_jobs) > 500 THEN
    RAISE EXCEPTION 'p_jobs must be an array of at most 500 jobs' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(p_jobs) AS x(
    external_id TEXT, employer_name TEXT, employer_slug TEXT, employer_domain TEXT, title TEXT, title_slug TEXT,
    locations JSONB, workplace TEXT, employment TEXT, min_usd INTEGER, max_usd INTEGER, currency TEXT,
    description TEXT, simhash BIGINT, posting_url TEXT, apply_url TEXT, published_at TIMESTAMPTZ,
    raw_hash TEXT, country_codes TEXT[])
  LOOP
    INSERT INTO public.canonical_employers (canonical_name, normalized_slug, primary_domain)
      VALUES (r.employer_name, r.employer_slug, r.employer_domain)
      ON CONFLICT DO NOTHING;
    SELECT id INTO v_employer FROM public.canonical_employers
      WHERE normalized_slug = r.employer_slug OR (r.employer_domain IS NOT NULL AND primary_domain = r.employer_domain)
      ORDER BY (normalized_slug = r.employer_slug) DESC LIMIT 1;

    -- (a) known sighting from this source → its canonical row (following a merge).
    SELECT COALESCE(cj.duplicate_of, cj.id), e.raw_payload_hash INTO v_job, v_old_hash
      FROM public.job_discovery_events e JOIN public.canonical_jobs cj ON cj.id = e.canonical_job_id
      WHERE e.job_source_id = p_job_source_id AND e.external_job_id = r.external_id;

    IF v_job IS NOT NULL THEN
      UPDATE public.canonical_jobs SET
        last_seen_at = NOW(), last_verified_active_at = NOW(), status = 'active',
        title = CASE WHEN v_old_hash IS DISTINCT FROM r.raw_hash THEN r.title ELSE title END,
        description_plain = CASE WHEN v_old_hash IS DISTINCT FROM r.raw_hash THEN r.description ELSE description_plain END,
        min_annual_salary_usd = CASE WHEN v_old_hash IS DISTINCT FROM r.raw_hash THEN r.min_usd ELSE min_annual_salary_usd END,
        max_annual_salary_usd = CASE WHEN v_old_hash IS DISTINCT FROM r.raw_hash THEN r.max_usd ELSE max_annual_salary_usd END,
        locations_json = public.jsonb_array_union(locations_json, r.locations),
        country_codes = ARRAY(SELECT DISTINCT x FROM unnest(country_codes || COALESCE(r.country_codes, '{}')) x ORDER BY x),
        region = public.region_from_country_codes(country_codes || COALESCE(r.country_codes, '{}')),
        -- changed text → re-embed on the next embedding pass
        requirements_embedding = CASE WHEN v_old_hash IS DISTINCT FROM r.raw_hash THEN NULL ELSE requirements_embedding END
      WHERE id = v_job;
      UPDATE public.job_discovery_events SET last_polled_at = NOW(), raw_payload_hash = r.raw_hash
        WHERE job_source_id = p_job_source_id AND external_job_id = r.external_id;
      v_upd := v_upd + 1;
      CONTINUE;
    END IF;

    -- (b) same role at another office of the same employer → merge into that keeper.
    SELECT cj.id INTO v_job FROM public.canonical_jobs cj
      WHERE cj.canonical_employer_id = v_employer AND cj.normalized_title_slug = r.title_slug
        AND cj.employment_type = COALESCE(r.employment, 'full_time')::employment_commitment_type
        AND cj.status = 'active' AND cj.duplicate_of IS NULL
      ORDER BY cj.first_discovered_at, cj.id LIMIT 1;

    IF v_job IS NOT NULL THEN
      UPDATE public.canonical_jobs SET
        last_seen_at = NOW(), last_verified_active_at = NOW(),
        locations_json = public.jsonb_array_union(locations_json, r.locations),
        country_codes = ARRAY(SELECT DISTINCT x FROM unnest(country_codes || COALESCE(r.country_codes, '{}')) x ORDER BY x),
        region = public.region_from_country_codes(country_codes || COALESCE(r.country_codes, '{}'))
      WHERE id = v_job;
      v_mer := v_mer + 1;
    ELSE
      INSERT INTO public.canonical_jobs (canonical_employer_id, identity_hash, description_simhash, title, normalized_title_slug,
        employer_name, locations_json, workplace_type, employment_type, min_annual_salary_usd, max_annual_salary_usd,
        salary_currency, description_plain, canonical_posting_url, application_url, original_published_at,
        country_codes, region, compliance_metadata)
      VALUES (v_employer,
        encode(sha256(convert_to(v_provider || '|' || COALESCE(v_tenant, '') || '|' || r.external_id, 'UTF8')), 'hex'),
        r.simhash, r.title, r.title_slug, r.employer_name, COALESCE(r.locations, '[]'),
        COALESCE(r.workplace, 'unspecified')::workplace_mode_type, COALESCE(r.employment, 'full_time')::employment_commitment_type,
        r.min_usd, r.max_usd, COALESCE(r.currency, 'USD'), r.description, r.posting_url, r.apply_url, r.published_at,
        COALESCE(r.country_codes, '{}'), public.region_from_country_codes(r.country_codes),
        jsonb_build_object('source', v_provider || ':' || COALESCE(v_tenant, ''), 'external_job_id', r.external_id))
      ON CONFLICT (identity_hash) DO UPDATE SET last_seen_at = NOW()
      RETURNING id INTO v_job;
      v_ins := v_ins + 1;
    END IF;

    INSERT INTO public.job_discovery_events (canonical_job_id, job_source_id, external_job_id, source_url, raw_payload_hash, last_polled_at)
      VALUES (v_job, p_job_source_id, r.external_id, r.posting_url, r.raw_hash, NOW())
      ON CONFLICT (job_source_id, external_job_id) DO UPDATE SET last_polled_at = NOW(), raw_payload_hash = EXCLUDED.raw_payload_hash;
  END LOOP;

  UPDATE public.job_sources SET last_synced_at = NOW(), consecutive_failures = 0 WHERE id = p_job_source_id;
  RETURN QUERY SELECT v_ins, v_mer, v_upd;
END;
$$;

-- Close jobs no source has listed for p_stale_hours (only sources that completed a full pull since).
CREATE OR REPLACE FUNCTION public.close_stale_jobs(p_stale_hours INTEGER DEFAULT 48)
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_closed INTEGER;
BEGIN
  IF p_stale_hours IS NULL OR p_stale_hours < 12 THEN
    RAISE EXCEPTION 'p_stale_hours must be at least 12' USING ERRCODE = '22023';
  END IF;
  UPDATE public.canonical_jobs cj SET status = 'closed'
  WHERE cj.status = 'active'
    AND EXISTS (SELECT 1 FROM public.job_discovery_events e JOIN public.job_sources s ON s.id = e.job_source_id
                WHERE e.canonical_job_id = cj.id AND s.is_active)
    AND NOT EXISTS (
      SELECT 1 FROM public.job_discovery_events e
      JOIN public.canonical_jobs c ON c.id = e.canonical_job_id
      WHERE (c.id = cj.id OR c.duplicate_of = cj.id)
        AND COALESCE(e.last_polled_at, e.discovered_at) > NOW() - make_interval(hours => p_stale_hours));
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$$;

-- Service-role only (the ingest worker and backfill script); never callable from the browser.
REVOKE ALL ON FUNCTION public.merge_duplicate_postings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_job_batch(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_stale_jobs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_postings() TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_job_batch(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_stale_jobs(INTEGER) TO service_role;

-- Failure bookkeeping for the ingest queue consumer (service role only).
CREATE OR REPLACE FUNCTION public.record_source_failure(p_job_source_id UUID)
RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.job_sources SET consecutive_failures = consecutive_failures + 1 WHERE id = p_job_source_id;
$$;
REVOKE ALL ON FUNCTION public.record_source_failure(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_source_failure(UUID) TO service_role;
