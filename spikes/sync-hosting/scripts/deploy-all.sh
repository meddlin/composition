#!/usr/bin/env bash
# Deploy all three candidates, then run the contract suite against each. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/deploy-lean.sh
bash scripts/deploy-postgres.sh
bash scripts/deploy-convex.sh
for c in lean postgres convex; do
  echo "== contract suite: $c"
  CANDIDATE=$c pnpm -s contract
done
