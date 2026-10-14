-- Jobr Milestone M1.1 / Phase 4: Stage 1 Deterministic Hard Filter & Stage 2 Hybrid RRF Retrieval RPC
-- File: supabase/migrations/0004_hybrid_search_rpc.sql
-- Executes with SECURITY INVOKER so PostgreSQL Row-Level Security (RLS) is strictly enforced.

CREATE OR REPLACE FUNCTION public.match_jobs_hybrid(
  p_candidate_profile_id UUID,
  p_query_text TEXT DEFAULT '',
  p_include_stretch_exceptions BOOLEAN DEFAULT false,
  p_rrf_k INTEGER DEFAULT 60,
  p_top_n INTEGER DEFAULT 50
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
  rrf_score DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_target_embedding vector(1536);
  v_excluded_employer_ids UUID[];
  v_excluded_tech_slugs TEXT[];
  v_allowed_workplace_types workplace_mode_type[];
  v_allowed_employment_types employment_commitment_type[];
  v_hard_min_salary INTEGER;
  v_allow_undisclosed_salary BOOLEAN;
  v_requires_visa BOOLEAN;
  v_home_geo geography(Point, 4326);
  v_max_commute_meters DOUBLE PRECISION;
BEGIN
  IF p_rrf_k IS NULL OR p_rrf_k < 1 OR p_top_n IS NULL OR p_top_n < 1 OR p_top_n > 50 THEN
    RAISE EXCEPTION 'Invalid hybrid query limits' USING ERRCODE = '22023';
  END IF;

  -- 1. Load candidate profile & preferences (enforced via RLS on candidate_profiles & job_preferences)
  SELECT
    cp.user_id,
    cp.target_job_embedding,
    COALESCE(jp.excluded_employer_ids, '{}'),
    COALESCE(jp.excluded_tech_slugs, '{}'),
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
      cj.search_tsv
    FROM public.canonical_jobs cj
    WHERE cj.status = 'active'
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
          AND (cj.workplace_type = ANY(v_allowed_workplace_types) OR cj.workplace_type = 'unspecified')
          AND (cj.employment_type = ANY(v_allowed_employment_types))
          AND (
            v_hard_min_salary IS NULL
            OR (cj.max_annual_salary_usd IS NOT NULL AND cj.max_annual_salary_usd >= v_hard_min_salary)
            OR (cj.max_annual_salary_usd IS NULL AND v_allow_undisclosed_salary = true)
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
            OR ST_DWithin(cj.primary_geo_point, v_home_geo, v_max_commute_meters)
          )
        )
      )
  ),
  semantic_top AS (
    -- STAGE 2A: Dense Vector Retrieval (pgvector Cosine Similarity)
    SELECT
      ej.id,
      CASE
        WHEN v_target_embedding IS NOT NULL AND ej.requirements_embedding IS NOT NULL
        THEN 1.0 - (ej.requirements_embedding <=> v_target_embedding)
        ELSE 0.0
      END AS sem_sim,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE
            WHEN v_target_embedding IS NOT NULL AND ej.requirements_embedding IS NOT NULL
            THEN (ej.requirements_embedding <=> v_target_embedding)
            ELSE 2.0
          END ASC
      ) AS sem_rank
    FROM eligible_jobs ej
    ORDER BY sem_rank
    LIMIT 200
  ),
  lexical_top AS (
    -- STAGE 2B: Sparse Lexical Retrieval (PostgreSQL Full-Text Search)
    SELECT
      ej.id,
      CASE
        WHEN trim(COALESCE(p_query_text, '')) <> ''
        THEN ts_rank_cd(ej.search_tsv, websearch_to_tsquery('english', p_query_text))::DOUBLE PRECISION
        ELSE 0.0
      END AS lex_score,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE
            WHEN trim(COALESCE(p_query_text, '')) <> ''
            THEN ts_rank_cd(ej.search_tsv, websearch_to_tsquery('english', p_query_text))
            ELSE 0.0
          END DESC,
          ej.id ASC
      ) AS lex_rank
    FROM eligible_jobs ej
    ORDER BY lex_rank
    LIMIT 200
  ),
  rrf_combined AS (
    -- STAGE 2C: Reciprocal Rank Fusion (RRF)
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
    rc.sem_sim AS semantic_similarity,
    rc.lex_score AS lexical_rank,
    rc.fused_rrf AS rrf_score
  FROM rrf_combined rc
  JOIN eligible_jobs ej ON ej.id = rc.job_id
  ORDER BY rc.fused_rrf DESC, rc.sem_sim DESC
  LIMIT p_top_n;
END;
$$;

REVOKE ALL ON FUNCTION public.match_jobs_hybrid(UUID, TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_jobs_hybrid(UUID, TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;
