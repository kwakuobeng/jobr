#!/usr/bin/env bash
# Run supabase/tests/*.sql with pg_prove against a throwaway local Postgres database.
# Requires: postgres superuser access (PGHOST/PGUSER env), pgtap, pgvector, postgis.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${JOBR_TEST_DB:-jobr_pgtap}"
dropdb --if-exists "$DB"
createdb "$DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c 'CREATE EXTENSION IF NOT EXISTS pgtap;'
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f scripts/local_supabase_stub.sql
for mig in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$mig"
done
pg_prove -v -d "$DB" supabase/tests/*.sql
