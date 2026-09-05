#!/usr/bin/env bash
# Install / refresh the LangExtract Python sidecar venv used by the Context Engine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR="$ROOT/services/langextract-sidecar"
VENV="$SIDECAR/.venv"
REQ="$SIDECAR/requirements.txt"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[langextract] python3 is required (brew install python@3.12 or similar)" >&2
  exit 1
fi

PY_VER="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
echo "[langextract] Using python3 ($PY_VER) → $VENV"

if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$REQ"

"$VENV/bin/python" -c "import langextract; print('[langextract] OK', getattr(langextract, '__version__', 'installed'))"

echo "$("$VENV/bin/python" -c 'import sys; print(sys.executable)')" > "$SIDECAR/.python-path"
echo "[langextract] Sidecar ready: $(cat "$SIDECAR/.python-path")"
echo "[langextract] Every npm run dev / launch will reuse this venv automatically."
