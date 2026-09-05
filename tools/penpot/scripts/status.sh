#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
  if command -v podman-compose >/dev/null 2>&1; then
    COMPOSE=(podman-compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    echo "compose: unavailable"
    exit 1
  fi
fi

"${COMPOSE[@]}" -f docker-compose.yml ps
if curl -sf -o /dev/null "http://localhost:9001/" 2>/dev/null; then
  echo "ui: http://localhost:9001 (up)"
else
  echo "ui: http://localhost:9001 (down)"
fi
