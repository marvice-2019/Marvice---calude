#!/bin/sh
# Runs every e2e script against `next start`, each group on a fresh database.
# Usage (from hourhand/, after `npx next build`): E2E_PG=postgres://user:pass@host:port sh e2e/run-all.sh
# E2E_PG is a Postgres server URL with no database name; hourhand_e2e is dropped and recreated on it.
PG=${E2E_PG:-postgres://postgres@localhost:54331}
DB=$PG/hourhand_e2e
OUT=${E2E_OUT:-e2e/.out}
mkdir -p "$OUT"
FAILED=0
fresh() {
  psql "$PG/postgres" -qc "drop database if exists hourhand_e2e with (force)" -c "create database hourhand_e2e" || exit 1
  DATABASE_URL=$DB node scripts/migrate.ts > /dev/null && DATABASE_URL=$DB node scripts/seed.ts > /dev/null || exit 1
}
# Waits for the server on port $1 to answer, up to 60 seconds.
up() { i=0; until curl -s -o /dev/null "http://localhost:$1/"; do i=$((i + 1)); [ $i -gt 120 ] && echo "FAILED: server on $1 never came up" && FAILED=1 && return 1; sleep 0.5; done; }
# A group fails on any FAIL line, or when it printed no OK line at all (the script crashed).
summary() {
  ok=$(grep -c '^OK' "$2"); bad=$(grep -c '^FAIL' "$2")
  printf '%s: %s OK, %s FAIL\n' "$1" "$ok" "$bad"; grep '^FAIL' "$2"
  if [ "$bad" -gt 0 ] || [ "$ok" -eq 0 ]; then FAILED=1; tail -20 "$2"; fi
}

fresh
node e2e/fake-google.mjs 3197 > $OUT/fakeg.log 2>&1 & FG=$!
: > $OUT/srv-b4.log
node e2e/start-e2e-b4.mjs 3150 $DB 3197 > $OUT/srv-b4.log 2>&1 & SRV=$!
up 3150
node e2e/e2e-b4.mjs 3150 $OUT/srv-b4.log $DB 3197 > $OUT/out-b4.txt 2>&1
kill $SRV $FG
summary B4 $OUT/out-b4.txt
sleep 2

fresh
: > $OUT/srv-b3.log
node e2e/start-e2e.mjs 3151 $DB > $OUT/srv-b3.log 2>&1 & SRV=$!
up 3151
node e2e/e2e-b3.mjs 3151 $OUT/srv-b3.log $DB > $OUT/out-b3.txt 2>&1
node e2e/e2e-b2b.mjs 3151 $OUT/srv-b3.log $DB > $OUT/out-b2b.txt 2>&1
kill $SRV
summary B3 $OUT/out-b3.txt
summary B2b $OUT/out-b2b.txt
sleep 2

: > $OUT/srv-auth.log
node e2e/start-e2e.mjs 3152 $DB > $OUT/srv-auth.log 2>&1 & SRV=$!
up 3152
node e2e/e2e-auth.mjs 3152 $OUT/srv-auth.log > $OUT/out-auth.txt 2>&1
kill $SRV
summary Sign-in $OUT/out-auth.txt
sleep 2

fresh
node e2e/fake-billing.mjs 3297 3298 > $OUT/fakeb.log 2>&1 & FB=$!
: > $OUT/srv-b5.log
node e2e/start-e2e-b5.mjs 3160 $DB 3297 3298 > $OUT/srv-b5.log 2>&1 & SRV=$!
up 3160
node e2e/e2e-b5.mjs 3160 $OUT/srv-b5.log $DB 3297 3298 > $OUT/out-b5.txt 2>&1
kill $SRV $FB
summary B5a $OUT/out-b5.txt
sleep 2

fresh
node e2e/fake-rzp-host.mjs 3397 > $OUT/fakerh.log 2>&1 & FR=$!
: > $OUT/srv-b5b.log
node e2e/start-e2e-b5b.mjs 3170 $DB 3397 3398 > $OUT/srv-b5b.log 2>&1 & SRV=$!
up 3170
node e2e/e2e-b5b.mjs 3170 $OUT/srv-b5b.log $DB 3397 > $OUT/out-b5b.txt 2>&1
kill $SRV $FR
summary B5b $OUT/out-b5b.txt
sleep 2

fresh
: > $OUT/srv-b7.log
node e2e/start-e2e.mjs 3180 $DB > $OUT/srv-b7.log 2>&1 & SRV=$!
up 3180
node e2e/e2e-b7.mjs 3180 $OUT/srv-b7.log $DB > $OUT/out-b7.txt 2>&1
kill $SRV
summary B7 $OUT/out-b7.txt
sleep 2

fresh
node e2e/fake-microsoft.mjs 3497 > $OUT/fakems.log 2>&1 & FM=$!
: > $OUT/srv-b6.log
node e2e/start-e2e-b6.mjs 3181 $DB 3497 > $OUT/srv-b6.log 2>&1 & SRV=$!
up 3181
node e2e/e2e-b6.mjs 3181 $OUT/srv-b6.log $DB 3497 > $OUT/out-b6.txt 2>&1
kill $SRV $FM
summary B6 $OUT/out-b6.txt
sleep 2

fresh
: > $OUT/srv-b8.log
node e2e/start-e2e.mjs 3190 $DB > $OUT/srv-b8.log 2>&1 & SRV=$!
up 3190
node e2e/e2e-b8.mjs 3190 $OUT/srv-b8.log $DB > $OUT/out-b8.txt 2>&1
kill $SRV
summary B8 $OUT/out-b8.txt
sleep 2

fresh
: > $OUT/srv-a.log
node e2e/start-e2e.mjs 3191 $DB > $OUT/srv-a.log 2>&1 & SRV=$!
up 3191
node e2e/e2e-batch-a.mjs 3191 > $OUT/out-a.txt 2>&1
node e2e/e2e-recurring.mjs 3191 $DB > $OUT/out-recurring.txt 2>&1
kill $SRV
summary BatchA $OUT/out-a.txt
summary Recurring $OUT/out-recurring.txt
sleep 2

fresh
node e2e/fake-rzp-host.mjs 3497 > $OUT/fakerh2.log 2>&1 & FR=$!
: > $OUT/srv-pkg.log
node e2e/start-e2e-b5b.mjs 3192 $DB 3497 3498 > $OUT/srv-pkg.log 2>&1 & SRV=$!
up 3192
node e2e/e2e-packages.mjs 3192 $OUT/srv-pkg.log $DB 3497 > $OUT/out-packages.txt 2>&1
kill $SRV $FR
summary Packages $OUT/out-packages.txt
sleep 2

fresh
node e2e/fake-rzp-host.mjs 3597 > $OUT/fakerh3.log 2>&1 & FR=$!
: > $OUT/srv-dep.log
node e2e/start-e2e-b5b.mjs 3193 $DB 3597 3598 > $OUT/srv-dep.log 2>&1 & SRV=$!
up 3193
node e2e/e2e-deposit.mjs 3193 $OUT/srv-dep.log $DB 3597 > $OUT/out-deposit.txt 2>&1
kill $SRV $FR
summary Deposit $OUT/out-deposit.txt
sleep 2

fresh
node e2e/fake-rzp-host.mjs 3697 > $OUT/fakerh4.log 2>&1 & FR=$!
: > $OUT/srv-gst.log
node e2e/start-e2e-b5b.mjs 3194 $DB 3697 3698 > $OUT/srv-gst.log 2>&1 & SRV=$!
up 3194
node e2e/e2e-gst.mjs 3194 $OUT/srv-gst.log $DB 3697 > $OUT/out-gst.txt 2>&1
kill $SRV $FR
summary GST $OUT/out-gst.txt
sleep 2

fresh
: > $OUT/srv-cl.log
node e2e/start-e2e.mjs 3195 $DB > $OUT/srv-cl.log 2>&1 & SRV=$!
up 3195
node e2e/e2e-clients.mjs 3195 $OUT/srv-cl.log $DB 0 > $OUT/out-clients.txt 2>&1
kill $SRV
summary Clients $OUT/out-clients.txt
sleep 2

fresh
: > $OUT/srv-wl.log
node e2e/start-e2e.mjs 3196 $DB > $OUT/srv-wl.log 2>&1 & SRV=$!
up 3196
node e2e/e2e-waitlist.mjs 3196 $OUT/srv-wl.log $DB > $OUT/out-waitlist.txt 2>&1
kill $SRV
summary Waitlist $OUT/out-waitlist.txt
sleep 2

fresh
: > $OUT/srv-pf.log
node e2e/start-e2e.mjs 3198 $DB > $OUT/srv-pf.log 2>&1 & SRV=$!
up 3198
node e2e/e2e-profile.mjs 3198 $OUT/srv-pf.log $DB > $OUT/out-profile.txt 2>&1
kill $SRV
summary Profile $OUT/out-profile.txt
sleep 2

fresh
: > $OUT/srv-seat.log
node e2e/start-e2e.mjs 3199 $DB > $OUT/srv-seat.log 2>&1 & SRV=$!
up 3199
node e2e/e2e-seat.mjs 3199 $OUT/srv-seat.log $DB > $OUT/out-seat.txt 2>&1
kill $SRV
summary Seat $OUT/out-seat.txt
sleep 2

fresh
: > $OUT/srv-i18n.log
node e2e/start-e2e.mjs 3200 $DB > $OUT/srv-i18n.log 2>&1 & SRV=$!
up 3200
node e2e/e2e-i18n.mjs 3200 $OUT/srv-i18n.log $DB > $OUT/out-i18n.txt 2>&1
kill $SRV
summary Languages $OUT/out-i18n.txt
sleep 2

fresh
node e2e/fake-caldav.mjs 3299 > $OUT/fakecal.log 2>&1 & FC=$!
: > $OUT/srv-ical.log
node e2e/start-e2e-icloud.mjs 3201 $DB 3299 > $OUT/srv-ical.log 2>&1 & SRV=$!
up 3201
node e2e/e2e-icloud.mjs 3201 $OUT/srv-ical.log $DB 3299 > $OUT/out-icloud.txt 2>&1
kill $SRV $FC
summary iCloud $OUT/out-icloud.txt
sleep 2

fresh
: > $OUT/srv-d1.log
node e2e/start-e2e.mjs 3202 $DB > $OUT/srv-d1.log 2>&1 & SRV=$!
up 3202
node e2e/e2e-d1.mjs 3202 $OUT/srv-d1.log $DB > $OUT/out-d1.txt 2>&1
kill $SRV
summary D1-calendar $OUT/out-d1.txt
sleep 2

fresh
: > $OUT/srv-d2.log
node e2e/start-e2e.mjs 3203 $DB > $OUT/srv-d2.log 2>&1 & SRV=$!
up 3203
node e2e/e2e-d2.mjs 3203 $OUT/srv-d2.log $DB > $OUT/out-d2.txt 2>&1
kill $SRV
summary D2-guests $OUT/out-d2.txt
sleep 2

fresh
: > $OUT/srv-d4.log
node e2e/start-e2e.mjs 3204 $DB > $OUT/srv-d4.log 2>&1 & SRV=$!
up 3204
node e2e/e2e-d4.mjs 3204 $OUT/srv-d4.log $DB > $OUT/out-d4.txt 2>&1
kill $SRV
summary D4-embed $OUT/out-d4.txt
sleep 2

fresh
: > $OUT/srv-d5.log
node e2e/start-e2e.mjs 3205 $DB > $OUT/srv-d5.log 2>&1 & SRV=$!
up 3205
node e2e/e2e-d5.mjs 3205 $OUT/srv-d5.log $DB > $OUT/out-d5.txt 2>&1
kill $SRV
summary D5-policy $OUT/out-d5.txt

exit $FAILED
