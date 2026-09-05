#!/usr/bin/env bash
# Copy singularity-ai bundle into vscode/.build/extensions for dev Electron.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/vscode/extensions/singularity-ai"
DEST="$ROOT/vscode/.build/extensions/singularity-ai"

if [[ ! -f "$SRC/dist/extension.js" ]]; then
  echo "[singularity] ERROR: $SRC/dist/extension.js missing — run npm run build:extension first" >&2
  exit 1
fi

mkdir -p "$DEST/dist/brain"
cp -f "$SRC/package.json" "$DEST/package.json"
cp -f "$SRC/dist/extension.js" "$DEST/dist/extension.js"
cp -f "$SRC/dist/extension.js.map" "$DEST/dist/extension.js.map" 2>/dev/null || true
cp -f "$SRC/dist/brain/viewer.js" "$DEST/dist/brain/viewer.js" 2>/dev/null || true
cp -f "$SRC/dist/brain/viewer.js.map" "$DEST/dist/brain/viewer.js.map" 2>/dev/null || true

echo "[singularity] Synced singularity-ai → vscode/.build/extensions/"
