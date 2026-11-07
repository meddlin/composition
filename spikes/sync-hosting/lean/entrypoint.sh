#!/bin/sh
# 1. Choose where the database is backed up: S3-compatible storage (LITESTREAM_BUCKET, e.g. Cloudflare R2, Backblaze B2,
#    MinIO), or a folder (LITESTREAM_FILE_PATH, e.g. a second disk or a NAS mount), or nowhere (loudly).
# 2. If the disk is empty and a replica exists, restore it. History was rebuilt, so rotate the epoch: devices see the new
#    epoch, resync, and re-push whatever the restored server lacks.
# 3. Run the API under Litestream, which replicates the database continuously and stops with it.
set -eu

DB="${DB_PATH:-/data/sync.db}"
mkdir -p "$(dirname "$DB")"

if [ -n "${LITESTREAM_BUCKET:-}" ]; then
  CONFIG=/etc/litestream.yml
  export LITESTREAM_REGION="${LITESTREAM_REGION:-auto}"
  export LITESTREAM_PATH="${LITESTREAM_PATH:-sync.db}"
  echo '{"ev":"replication","to":"s3-compatible bucket"}'
elif [ -n "${LITESTREAM_FILE_PATH:-}" ]; then
  CONFIG=/etc/litestream-file.yml
  mkdir -p "$LITESTREAM_FILE_PATH"
  echo '{"ev":"replication","to":"folder"}'
else
  echo '{"ev":"replication-off","warning":"NO BACKUP IS CONFIGURED. If this disk is lost, so is every note on the server (your devices keep their own copies). Set LITESTREAM_FILE_PATH or LITESTREAM_BUCKET."}'
  exec node lean/main.ts
fi

if [ ! -f "$DB" ]; then
  echo '{"ev":"restore-start"}'
  if litestream restore -if-replica-exists -config "$CONFIG" "$DB"; then
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

exec litestream replicate -config "$CONFIG" -exec "node lean/main.ts"
