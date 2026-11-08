#!/usr/bin/env bash
# Runs the HTTP contract suite against the self-host container, signing in with tokens created by its own CLI, on a
# throwaway compose project. The container has no admin token, so the 27 tests that need none run (`pnpm test` runs all 30
# against a plain process). Needs Docker, jq and Node 24 on the host; nothing to install.
set -uo pipefail
cd "$(dirname "$0")"
COMPOSE="$PWD/compose.yaml"   # absolute: the script changes directory before the cleanup trap runs
PROJECT=composition-sync-contract; PORT=18081; BACKUP=$(mktemp -d); export SYNC_PORT=$PORT BACKUP_DIR=$BACKUP
dc() { docker compose -p $PROJECT -f "$COMPOSE" "$@"; }
# Litestream runs as root in the container, so on Linux the backup folder can hold files the host user may not delete:
# fall back to deleting them from inside the image.
rm_backup() { rm -rf "$BACKUP" 2>/dev/null || docker run --rm --entrypoint sh -v "$BACKUP:/b" composition-sync:local -c 'rm -rf /b/* /b/.[!.]*' >/dev/null 2>&1; rm -rf "$BACKUP"; }
trap 'dc down -v >/dev/null 2>&1; rm_backup' EXIT
dc up -d --build >/dev/null 2>&1 || { echo "build or start failed"; exit 1; }
for _ in $(seq 1 90); do [[ "$(docker inspect --format '{{.State.Health.Status}}' "$(dc ps -q sync)" 2>/dev/null)" == healthy ]] && break; sleep 1; done

# One token per (user, device) the suite uses, in the {token: {user, device}} shape its client reads.
TOKENS='{}'
for pair in ct-alice/a ct-alice/b ct-alice/c ct-alice/d ct-bob/a; do
  user=${pair%/*}; device=${pair#*/}
  token=$(dc exec -T sync node lean/tokens.ts add "$user" "$device" 2>/dev/null | tail -1)
  TOKENS=$(jq -c --arg t "$token" --arg u "$user" --arg d "$device" '. + {($t): {user: $u, device: $d}}' <<<"$TOKENS")
done
cd ..
# Print only failures and the totals, but keep the suite's own exit status (a pipe to grep would swallow it).
out=$(SYNC_DEV_TOKENS="$TOKENS" BASE_URL="http://127.0.0.1:$PORT" node --test protocol/contract/suite.test.ts 2>&1); status=$?
grep -E "✖|^ℹ (tests|pass|fail|skipped)" <<<"$out"
exit $status
