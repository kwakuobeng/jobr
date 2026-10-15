-- 0008: card metadata for Matches sorting (Newest, Distance). Additive only; 0001-0007 unchanged.
-- SECURITY INVOKER: canonical_jobs RLS (authenticated read) applies. Bounded to 50 ids per call.
CREATE OR REPLACE FUNCTION public.job_card_meta(p_job_ids UUID[])
RETURNS TABLE (
  canonical_job_id UUID,
  original_published_at TIMESTAMPTZ,
  first_discovered_at TIMESTAMPTZ,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_job_ids IS NULL OR cardinality(p_job_ids) > 50 THEN
    RAISE EXCEPTION 'p_job_ids must contain at most 50 ids' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT cj.id, cj.original_published_at, cj.first_discovered_at,
    CASE WHEN cj.primary_geo_point IS NULL THEN NULL ELSE extensions.st_y(cj.primary_geo_point::extensions.geometry) END,
    CASE WHEN cj.primary_geo_point IS NULL THEN NULL ELSE extensions.st_x(cj.primary_geo_point::extensions.geometry) END
  FROM public.canonical_jobs cj
  WHERE cj.id = ANY (p_job_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.job_card_meta(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_card_meta(UUID[]) TO authenticated;

-- Home ZIP for the existing commute radius. 0001 already has job_preferences.home_geo_point and
-- max_commute_miles, and match_jobs_hybrid (0006) already exempts remote roles and keeps jobs without
-- coordinates. The app derives home_geo_point from this ZIP with a bundled offline lookup.
ALTER TABLE public.job_preferences
  ADD COLUMN IF NOT EXISTS home_zip TEXT CHECK (home_zip IS NULL OR home_zip ~ '^[0-9]{5}$');
