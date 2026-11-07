#!/bin/sh
# 1. If the disk is empty and a replica exists, restore it. History was rebuilt, so rotate the epoch:
#    devices see the new epoch, resync, and re-push whatever the restored server lacks.
# 2. Run the API under Litestream, which replicates the database continuously and stops with it.
set -eu

DB="${DB_PATH:-/data/sync.db}"
mkdir -p "$(dirname "$DB")"

if [ -z "${LITESTREAM_BUCKET:-}" ]; then
  echo '{"ev":"replication-off","reason":"LITESTREAM_BUCKET is not set"}'
  exec node lean/main.ts
fi

export LITESTREAM_REGION="${LITESTREAM_REGION:-auto}"
export LITESTREAM_PATH="${LITESTREAM_PATH:-sync.db}"

if [ ! -f "$DB" ]; then
  echo '{"ev":"restore-start"}'
  if litestream restore -if-replica-exists -config /etc/litestream.yml "$DB"; then
    if [ -f "$DB" ]; then
      echo '{"ev":"restored"}'
      node lean/rotate-epoch.ts
    else
      echo '{"ev":"no-replica","note":"starting with an empty database"}'
    fi
  else
    echo '{"ev":"restore-failed"}' >&2
    exit 1
  fi
fi

exec litestream replicate -config /etc/litestream.yml -exec "node lean/main.ts"
