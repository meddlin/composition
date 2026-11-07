# Shared helpers for the drill and deploy scripts. Source it from a script that has already cd'd to the spike root.
# Env files hold values like JSON that bash cannot `source`, so values are read by key and never echoed.

get() { grep -h "^$1=" .env.*local 2>/dev/null | tail -n1 | cut -d= -f2-; }

need() {
  local v; v=$(get "$1")
  [[ -n "$v" ]] || { echo "missing $1: run scripts/wizard.sh" >&2; exit 1; }
  printf '%s' "$v"
}

fly_app() { # fly_app lean|pg
  printf 'comp-sync-%s-%s' "$1" "$(need FLY_APP_SUFFIX)"
}

# Any device token, to probe that the API AND its database answer.
probe_token() { get SYNC_DEV_TOKENS | jq -r 'to_entries | map(select(.value.user=="s-drill"))[0].key'; }

# wait_ready URL [timeoutSeconds]: block until an authenticated, database-backed request succeeds.
wait_ready() {
  local url="$1" timeout="${2:-600}" token started now
  token=$(probe_token)
  started=$(date +%s)
  until curl -sf --max-time 8 -X POST "$url/v1/sync" \
      -H "authorization: Bearer $token" -H 'content-type: application/json' \
      -d '{"protocolVersion":1,"batchId":"b_probe_0001","cursor":0,"changes":[],"pullLimit":0}' >/dev/null 2>&1; do
    now=$(date +%s)
    (( now - started < timeout )) || { echo "timed out waiting for $url" >&2; return 1; }
    sleep 0.5
  done
}

neon_api() { # neon_api METHOD PATH [json]
  local method="$1" path="$2" body="${3:-}"
  curl -sf -X "$method" "https://console.neon.tech/api/v2$path" \
    -H "authorization: Bearer $(need NEON_API_KEY)" -H 'content-type: application/json' \
    ${body:+-d "$body"}
}

# The local anonymous `convex dev` writes .env.local with CONVEX_DEPLOYMENT, which the Convex CLI would mix up with a
# production deploy key. Move it aside for the life of the calling script and put it back on exit.
hide_local_convex() {
  if [[ -f .env.local ]] && grep -q '^CONVEX_DEPLOYMENT=' .env.local; then
    mv .env.local .env.local.hidden
    trap 'mv .env.local.hidden .env.local 2>/dev/null || true' EXIT
  fi
}
