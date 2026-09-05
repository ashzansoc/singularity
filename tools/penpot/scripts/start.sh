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
    echo "error: docker compose / podman-compose not found" >&2
    exit 1
  fi
fi

echo "[penpot] pulling images + starting stack (UI → http://localhost:9001)…"
"${COMPOSE[@]}" -f docker-compose.yml up -d --pull missing
echo "[penpot] waiting for frontend…"
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:9001/" 2>/dev/null; then
    echo "[penpot] ready at http://localhost:9001"
    exit 0
  fi
  sleep 2
done
echo "[penpot] started but health check timed out — open http://localhost:9001 shortly"
exit 0
