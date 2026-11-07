#!/usr/bin/env bash
# End-to-end check of the self-hosted container, on its own compose project and port, leaving nothing behind:
#   build and start -> healthy -> no token is refused -> create a token -> a push works -> a restart keeps everything ->
#   the disk is destroyed and restored from the backup folder (the token still works, the epoch changed) ->
#   revoke -> refused. Add --https to also run the Caddy profile (pulls caddy:2; uses a local certificate).
set -uo pipefail
cd "$(dirname "$0")"
PROJECT=composition-sync-smoke; PORT=18080; BACKUP=$(mktemp -d); PULL=$(mktemp); export SYNC_PORT=$PORT BACKUP_DIR=$BACKUP
dc() { docker compose -p $PROJECT -f compose.yaml "$@"; }
fails=0
ok() { echo "  ok    $1"; }
bad() { echo "  FAIL  $1${2:+ ($2)}"; fails=$((fails+1)); }
# Litestream runs as root in the container, so on Linux the backup folder can hold files the host user may not delete:
# fall back to deleting them from inside the image.
rm_backup() { rm -rf "$BACKUP" 2>/dev/null || docker run --rm --entrypoint sh -v "$BACKUP:/b" composition-sync:local -c 'rm -rf /b/* /b/.[!.]*' >/dev/null 2>&1; rm -rf "$BACKUP"; }
cleanup() { dc --profile https down -v >/dev/null 2>&1; rm_backup; rm -f "$PULL"; }
trap cleanup EXIT

# Capture the log first: with pipefail, `logs | grep -q` fails when grep exits early and logs dies of SIGPIPE.
has_log() { local out; out=$(dc logs sync 2>&1); grep -q "$1" <<<"$out"; }
healthy() { for _ in $(seq 1 90); do [[ "$(docker inspect --format '{{.State.Health.Status}}' "$(dc ps -q sync)" 2>/dev/null)" == healthy ]] && return 0; sleep 1; done; return 1; }
sync() { curl -s -m 10 -o "${2:-/dev/null}" -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/v1/sync" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
EMPTY='{"protocolVersion":1,"batchId":"b_smoke_0001","cursor":0,"changes":[],"pullLimit":200}'
UUID=$(openssl rand -hex 16)
PUSH="{\"protocolVersion\":1,\"batchId\":\"b_smoke_$(openssl rand -hex 4)\",\"cursor\":0,\"pullLimit\":0,\"changes\":[{\"entity\":\"note\",\"uuid\":\"$UUID\",\"baseVersion\":0,\"deleted\":false,\"schemaVersion\":1,\"payload\":\"aGVsbG8=\"}]}"

echo "== build and start"
dc up -d --build >/dev/null 2>&1 && ok "built and started" || { bad "build or start"; exit 1; }
healthy && ok "container reports healthy" || bad "never became healthy"
[[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/v1/info)" == 200 ]] && ok "GET /v1/info answers" || bad "/v1/info"
has_log '"no-devices"' && ok "says that no device can sign in yet" || bad "no no-devices hint in the log"
has_log '"to":"folder"' && ok "replicating to the backup folder" || bad "not replicating to the folder"

echo "== a device token"
[[ "$(sync cst_nope /dev/null "$EMPTY")" == 401 ]] && ok "an unknown token is refused" || bad "unknown token accepted"
TOKEN=$(dc exec -T sync node lean/tokens.ts add smoke ipad 2>/dev/null | tail -1)
[[ "$TOKEN" == cst_* ]] && ok "token created" || bad "token not created" "$TOKEN"
[[ "$(sync "$TOKEN" /dev/null "$PUSH")" == 200 ]] && ok "an authenticated push works" || bad "push refused"
EPOCH1=$(curl -s http://127.0.0.1:$PORT/v1/info | jq -r .epoch)

echo "== a restart keeps everything"
dc restart sync >/dev/null 2>&1; healthy && ok "healthy again" || bad "not healthy after restart"
[[ "$(sync "$TOKEN" "$PULL" "$EMPTY")" == 200 ]] && ok "the token still works" || bad "token lost on restart"
jq -e --arg u "$UUID" '.changes | map(.uuid) | index($u) != null' "$PULL" >/dev/null && ok "the record is still there" || bad "record lost on restart"

echo "== lose the disk, restore from the backup folder"
sleep 3   # let the replica catch up (it syncs every second)
dc rm -sf sync >/dev/null 2>&1; docker volume rm -f ${PROJECT}_data >/dev/null 2>&1
dc up -d >/dev/null 2>&1; healthy && ok "started on an empty disk and became healthy" || bad "not healthy after restore"
has_log '"restored"' && ok "restored from the backup folder" || bad "did not restore"
EPOCH2=$(curl -s http://127.0.0.1:$PORT/v1/info | jq -r .epoch)
[[ -n "$EPOCH2" && "$EPOCH1" != "$EPOCH2" ]] && ok "the epoch changed, so devices will resync" || bad "epoch unchanged" "$EPOCH1 / $EPOCH2"
[[ "$(sync "$TOKEN" "$PULL" "$EMPTY")" == 200 ]] && ok "the token survived the restore" || bad "token lost in the restore"
jq -e --arg u "$UUID" '.changes | map(.uuid) | index($u) != null' "$PULL" >/dev/null && ok "the record survived the restore" || bad "record lost in the restore"

echo "== revoke"
ID=$(dc exec -T sync node lean/tokens.ts list 2>/dev/null | awk 'NR==1{print $1}')
dc exec -T sync node lean/tokens.ts revoke "$ID" >/dev/null 2>&1
[[ "$(sync "$TOKEN" /dev/null "$EMPTY")" == 401 ]] && ok "a revoked token is refused" || bad "revoked token still works"

if [[ "${1:-}" == --https ]]; then
  echo "== https profile (local certificate)"
  SYNC_DOMAIN=localhost dc --profile https up -d >/dev/null 2>&1
  sleep 6
  code=$(curl -sk -m 10 -o /dev/null -w '%{http_code}' https://localhost/v1/info); [[ "$code" == 200 ]] && ok "https://localhost/v1/info answers through Caddy" || bad "https through Caddy" "$code"
  NEW=$(dc exec -T sync node lean/tokens.ts add smoke desktop 2>/dev/null | tail -1)
  got=$(curl -sk -N -m 5 -H "authorization: Bearer $NEW" https://localhost/v1/events 2>/dev/null | head -c 400 || true)
  echo "$got" | grep -q "event: hint" && ok "the event stream arrives through Caddy unbuffered" || bad "no hint through Caddy" "$got"
fi

echo; (( fails == 0 )) && echo "all checks passed" || echo "$fails check(s) failed"
exit $(( fails > 0 ))
