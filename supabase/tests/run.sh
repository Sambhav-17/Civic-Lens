#!/bin/bash
# Runs the migrations + security/workflow tests against a plain local Postgres 15+.
# Supabase platform pieces (auth, storage, realtime, default grants) are stubbed in bootstrap.sql;
# PostGIS calls are swapped for a haversine stand-in so PostGIS isn't required.
# Usage: PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LC_ALL=C
TMP=$(mktemp -d)
python3 - "$TMP" <<'PY'
import re, sys
out = sys.argv[1]
s1 = open('migrations/0001_schema.sql').read().replace("create extension if not exists postgis with schema extensions;\n", "")
s1 = re.sub(r"  location extensions\.geography\(Point, 4326\)\n\s+generated always as \(.*?\) stored,\n",
            "  location double precision[] generated always as (array[latitude, longitude]) stored,\n", s1, flags=re.S)
s1 = s1.replace("using gist (location)", "(latitude, longitude)")
s2 = re.sub(r"extensions\.st_dwithin\(location, extensions\.st_setsrid\(extensions\.st_makepoint\(p_lng, p_lat\), 4326\)::extensions\.geography, 30\)",
            "extensions.st_dwithin(location, array[p_lat, p_lng], 30)", open('migrations/0002_functions.sql').read())
open(f'{out}/m1.sql', 'w').write(s1); open(f'{out}/m2.sql', 'w').write(s2)
PY
psql -qc "drop database if exists civiclens_test" && psql -qc "create database civiclens_test"
psql -d civiclens_test -q -f tests/bootstrap.sql >/dev/null 2>&1
for f in "$TMP/m1.sql" "$TMP/m2.sql" migrations/0003_security.sql; do psql -d civiclens_test -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -d civiclens_test -f tests/security.test.sql > "$TMP/out.txt" 2>&1 || true
OK=$(grep -cx ok "$TMP/out.txt" || true)
FAILS=$(grep -E '^FAIL|ERROR' "$TMP/out.txt" || true)
echo "passed: $OK"
if [ -n "$FAILS" ]; then echo "$FAILS"; exit 1; fi
