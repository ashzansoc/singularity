#!/usr/bin/env bash
# Free disk/RAM by removing regenerable caches, clones, and local junk.
# Does NOT delete source, secrets, or the final release artifacts in release/out/*.dmg|*.zip
#
# Usage:
#   bash scripts/cleanup.sh
#   bash scripts/cleanup.sh --aggressive   # also drop vscode node_modules (re-npm-install required)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGGRESSIVE=0
if [[ "${1:-}" == "--aggressive" ]]; then
  AGGRESSIVE=1
fi

freed_before="$(du -sk "$ROOT" 2>/dev/null | awk '{print $1}')"

rm_rf() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    local size
    size="$(du -sh "$path" 2>/dev/null | awk '{print $1}')"
    echo "  removing $path ($size)"
    rm -rf "$path"
  fi
}

echo "==> Singularity cleanup ($ROOT)"

# Design reference clones (reinstall via: npm run install-design-refs)
rm_rf "$ROOT/packages/design/refs"
# Workspace symlink copy of the same refs
if [[ -d "$ROOT/node_modules/@singularity/design/refs" ]]; then
  rm_rf "$ROOT/node_modules/@singularity/design/refs"
fi

# VS Code compile / package caches (recreated by gulp / npm run compile)
rm_rf "$ROOT/vscode/.build"
rm_rf "$ROOT/vscode/out"
rm_rf "$ROOT/vscode/out-build"
rm_rf "$ROOT/vscode/out-vscode"
rm_rf "$ROOT/vscode/out-vscode-min"
rm_rf "$ROOT/vscode/out-vscode-reh"
rm_rf "$ROOT/vscode/out-vscode-reh-web"
rm_rf "$ROOT/VSCode-darwin-arm64"
rm_rf "$ROOT/VSCode-darwin-x64"

# Extension build noise
rm_rf "$ROOT/vscode/extensions/singularity-chat/dist-sourcemaps"
find "$ROOT/vscode/extensions" -maxdepth 2 -type d -name 'dist-sourcemaps' -prune -exec rm -rf {} + 2>/dev/null || true

# Update-server deps (reinstall on publish)
rm_rf "$ROOT/release/update-server/functions/node_modules"

# Root junk / duplicate assets (canonical copies live under vscode media / branding)
rm_rf "$ROOT/.tmp-icon-check"
rm_rf "$ROOT/.tmp-icons"
rm_rf "$ROOT/awesome_lathusca"
rm_rf "$ROOT/SINGULARITY-bg.png"
rm_rf "$ROOT/space-invaders.html"
# Duplicate logo assets at repo root if present
rm_rf "$ROOT/singularity logo.png"

# Stale release logs / empty dmg workdirs (keep real .dmg/.zip)
rm_rf "$ROOT/release/out/.dmg-build"
rm_rf "$ROOT/release/out/build.log"
rm_rf "$ROOT/release/out/.zip-upload.json"
rm_rf "$ROOT/release/out/.dmg-upload.json"

if [[ "$AGGRESSIVE" -eq 1 ]]; then
  echo "==> Aggressive: removing node_modules (you must reinstall)"
  rm_rf "$ROOT/node_modules"
  rm_rf "$ROOT/vscode/node_modules"
  rm_rf "$ROOT/vscode/extensions/node_modules"
  rm_rf "$ROOT/vscode/extensions/singularity-chat/node_modules"
  find "$ROOT/vscode/extensions" -maxdepth 2 -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null || true
fi

# Clear macOS ds_store noise
find "$ROOT" -name '.DS_Store' -type f -delete 2>/dev/null || true

freed_after="$(du -sk "$ROOT" 2>/dev/null | awk '{print $1}')"
saved_kb=$((freed_before - freed_after))
if [[ "$saved_kb" -lt 0 ]]; then saved_kb=0; fi
saved_mb=$((saved_kb / 1024))

echo ""
echo "Done. Roughly freed ~${saved_mb} MB."
echo "Repo size now: $(du -sh "$ROOT" | awk '{print $1}')"
echo ""
echo "Next:"
echo "  npm run build:dmg          # production macOS app + DMG/ZIP"
echo "  npm run publish:update     # upload + host install.sh (Firebase)"
echo "  curl -fsSL https://singularity-ide.web.app/install.sh | bash"
