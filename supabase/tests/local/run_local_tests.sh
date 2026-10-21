#!/usr/bin/env bash
# ทดสอบ migration + ชุดทดสอบ SQL กับ Postgres ในเครื่อง (ต้องมี Postgres 16+ และสิทธิ์ root เพื่อติดตั้ง pg_net จำลอง)
# ใช้: PGHOST=/var/run/postgresql PGPORT=54329 supabase/tests/local/run_local_tests.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
extdir="$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/16)/extension"
install -m 644 "$here/pg_net_stub/pg_net.control" "$here/pg_net_stub/pg_net--0.0.1.sql" "$extdir/"
db="leave_test_$$"
psql -X -q -U supabase_admin -d postgres -c "create database $db" >/dev/null
trap 'psql -X -q -U supabase_admin -d postgres -c "drop database if exists $db" >/dev/null' EXIT
psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d "$db" -f "$here/supabase_shim.sql" >/dev/null
for f in "$root"/supabase/migrations/*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$db" -f "$f" >/dev/null || { echo "migration failed: $f"; exit 1; }
done
status=0
for t in "$root"/supabase/tests/*.sql; do
  out="$(psql -X -q -U postgres -d "$db" -f "$t" 2>&1 || true)"
  echo "$out" | grep -E "TEST REPORT|ERROR" | sed 's/^psql:[^:]*:[0-9]*: //' || true
  echo "$out" | grep -q "fail=0" || status=1
done
exit $status
