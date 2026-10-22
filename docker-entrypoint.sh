#!/bin/sh
set -eu

evidence_path="${EVIDENCE_STORAGE_PATH:-}"

# Docker creates a new named-volume root as root. Repair only the dedicated
# application data subtree, then immediately drop privileges for the server.
if [ "$(id -u)" = "0" ]; then
  case "$evidence_path" in
    /app/data/*)
      mkdir -p "$evidence_path"
      chown node:node "$evidence_path"
      chmod 0700 "$evidence_path"
      ;;
  esac
  exec su-exec node "$@"
fi

exec "$@"
