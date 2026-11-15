#!/bin/sh
set -e
case "${PUID}" in ''|*[!0-9]*) echo "Error: PUID must be a number" >&2; exit 1;; esac
case "${PGID}" in ''|*[!0-9]*) echo "Error: PGID must be a number" >&2; exit 1;; esac
chown -R "${PUID}:${PGID}" /data
exec su-exec "${PUID}:${PGID}" node dist/index.js
