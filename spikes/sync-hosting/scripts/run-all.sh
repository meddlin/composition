#!/usr/bin/env bash
# Run every scenario and drill against each candidate and write results under results/<local|real>/.
#   bash scripts/run-all.sh local              # against the local servers (see README: start them first)
#   bash scripts/run-all.sh real               # against the deployed hosts (after scripts/deploy-all.sh)
#   bash scripts/run-all.sh real lean convex   # a subset
# IDLE_SECONDS sets the idle pause (default 600 for real, 20 for local). Idle runs first, for all candidates at once.
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/drills/lib.sh

mode="${1:?local|real}"; shift || true
cands=("$@"); (( ${#cands[@]} )) || cands=(lean postgres convex)
if [[ "$mode" == local ]]; then drill=local; idle=${IDLE_SECONDS:-20}; cvx=local; else drill=fly; idle=${IDLE_SECONDS:-600}; cvx=prod; fi
mkdir -p .local
failed=0
run() { echo; echo "### $*"; "$@" || failed=$((failed+1)); }

# Which candidates answer? Fail early rather than half-way through.
for c in "${cands[@]}"; do
  CANDIDATE=$c node --env-file-if-exists=.env.tokens.local --env-file-if-exists=.env.candidates.local -e '
    const n=process.env.CANDIDATE.toUpperCase(); const d={LEAN:"http://127.0.0.1:8787",POSTGRES:"http://127.0.0.1:8788",CONVEX:"http://127.0.0.1:3211"};
    const u=(process.env["SYNC_URL_"+n]??d[n]); fetch(u+"/v1/info",{signal:AbortSignal.timeout(20000)}).then(r=>{ if(!r.ok) throw new Error(r.status); console.log("ok  "+process.env.CANDIDATE+" "+u)}).catch(e=>{console.error("FAIL "+process.env.CANDIDATE+" "+u+" "+e.message); process.exit(1)})' || exit 1
done

# Idle first, and alone: it only means something if nothing else is touching the target while it sleeps
# (a Neon database that other scenarios keep awake would prove nothing). The candidates are independent hosts,
# so all of them idle at the same time.
echo "== idle ($idle s) for all candidates at once"
idle_pids=()
for c in "${cands[@]}"; do
  pnpm -s scenario idle --candidate "$c" --idle-seconds "$idle" > ".local/idle-$c.log" 2>&1 &
  idle_pids+=($!)
done
for pid in "${idle_pids[@]}"; do wait "$pid" || failed=$((failed+1)); done
for c in "${cands[@]}"; do echo "--- idle $c"; tail -n 14 ".local/idle-$c.log"; done

for c in "${cands[@]}"; do
  echo; echo "============================== $c ($mode)"
  run pnpm -s scenario normal burst library concurrent faults --candidate "$c"
  case "$c" in
    lean)
      run pnpm -s scenario outage --candidate lean --what api --down-seconds 10 \
        --down-cmd "bash scripts/drills/lean.sh $drill down" --up-cmd "bash scripts/drills/lean.sh $drill up"
      # The disk is the database: losing it is the restore drill. Calm, then straight after a write (the loss window).
      run pnpm -s scenario restore --candidate lean --settle-ms 5000 --restore-cmd "bash scripts/drills/lean.sh $drill restore"
      run pnpm -s scenario restore --candidate lean --name restore-immediate --settle-ms 0 --restore-cmd "bash scripts/drills/lean.sh $drill restore" ;;
    postgres)
      run pnpm -s scenario outage --candidate postgres --what api --down-seconds 10 \
        --down-cmd "bash scripts/drills/postgres.sh $drill down" --up-cmd "bash scripts/drills/postgres.sh $drill up"
      run pnpm -s scenario outage --candidate postgres --what database --down-seconds 10 \
        --down-cmd "bash scripts/drills/postgres.sh $drill db-down" --up-cmd "bash scripts/drills/postgres.sh $drill db-up"
      run pnpm -s scenario restore --candidate postgres \
        --backup-cmd "bash scripts/drills/postgres.sh $drill backup" --restore-cmd "bash scripts/drills/postgres.sh $drill restore" ;;
    convex)
      run pnpm -s scenario outage --candidate convex --what api --skip-reason "Convex runs the API and the database; there is no process or disk to kill from outside"
      run pnpm -s scenario restore --candidate convex \
        --backup-cmd "bash scripts/drills/convex.sh $cvx backup" --restore-cmd "bash scripts/drills/convex.sh $cvx restore" ;;
  esac
done

node scripts/summarize.ts "$mode"
echo; echo "$failed scenario run(s) reported a failed check."
exit $(( failed > 0 ))
