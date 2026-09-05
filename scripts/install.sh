#!/usr/bin/env bash
# Install Singularity from the hosted release (macOS).
#
# One-liner:
#   curl -fsSL https://singularity-ide.web.app/install.sh | bash
#
# Optional:
#   SINGULARITY_INSTALL_DIR="$HOME/Applications" bash <(curl -fsSL https://singularity-ide.web.app/install.sh)

set -euo pipefail

HOST="${SINGULARITY_HOST:-https://singularity-ide.web.app}"
MANIFEST_URL="${SINGULARITY_MANIFEST_URL:-$HOST/api/releases/manifest.json}"
INSTALL_DIR="${SINGULARITY_INSTALL_DIR:-/Applications}"
APP_NAME="Singularity.app"
TMP_DIR="$(mktemp -d -t singularity-install)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer currently supports macOS only." >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  arm64) PLATFORM_KEYS="darwin-arm64 darwin" ;;
  x86_64) PLATFORM_KEYS="darwin-x64 darwin" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

echo "==> Singularity installer"
echo "    host=$HOST"
echo "    arch=$arch"
echo "    install dir=$INSTALL_DIR"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

MANIFEST="$TMP_DIR/manifest.json"
echo "==> Fetching release manifest"
if ! curl -fsSL "$MANIFEST_URL" -o "$MANIFEST"; then
  echo "Failed to download manifest from $MANIFEST_URL" >&2
  exit 1
fi

JSON_HELPER="$TMP_DIR/pick.py"
cat > "$JSON_HELPER" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
kind = sys.argv[2]
keys = sys.argv[3:]
platforms = manifest.get("platforms") or {}
for key in keys:
    entry = platforms.get(key) or {}
    url = entry.get(kind)
    if url:
        print(url)
        raise SystemExit(0)
raise SystemExit(2)
PY

pick_url() {
  local kind="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 "$JSON_HELPER" "$MANIFEST" "$kind" $PLATFORM_KEYS
  elif command -v node >/dev/null 2>&1; then
    node -e '
const fs=require("fs");
const kind=process.argv[1];
const keys=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(process.env.MANIFEST,"utf8"));
for (const k of keys){const u=m.platforms?.[k]?.[kind]; if(u){process.stdout.write(u); process.exit(0)}}
process.exit(2);
    ' "$kind" $PLATFORM_KEYS
  else
    echo "python3 or node is required to parse the release manifest." >&2
    exit 1
  fi
}

export MANIFEST
ZIP_URL="$(pick_url zip || true)"
DMG_URL="$(pick_url dmg || true)"
if command -v python3 >/dev/null 2>&1; then
  VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("latestVersion",""))' "$MANIFEST")"
else
  VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.env.MANIFEST,'utf8')).latestVersion||''")"
fi

if [[ -z "$ZIP_URL" && -z "$DMG_URL" ]]; then
  echo "No macOS download URL found in manifest." >&2
  exit 1
fi

DEST="${INSTALL_DIR}/${APP_NAME}"
DOWNLOAD_URL="${ZIP_URL:-$DMG_URL}"
DOWNLOAD_KIND="zip"
if [[ -z "$ZIP_URL" ]]; then
  DOWNLOAD_KIND="dmg"
fi

echo "==> Downloading Singularity ${VERSION:-release} ($DOWNLOAD_KIND)"
ASSET="$TMP_DIR/singularity.$DOWNLOAD_KIND"
curl -fL --progress-bar "$DOWNLOAD_URL" -o "$ASSET"

echo "==> Installing to $DEST"
mkdir -p "$INSTALL_DIR"

if [[ "$DOWNLOAD_KIND" == "zip" ]]; then
  EXTRACT="$TMP_DIR/extract"
  mkdir -p "$EXTRACT"
  ditto -x -k "$ASSET" "$EXTRACT"
  FOUND_APP="$(find "$EXTRACT" -maxdepth 3 -name "$APP_NAME" -type d | head -1 || true)"
  if [[ -z "$FOUND_APP" ]]; then
    echo "Archive did not contain $APP_NAME" >&2
    exit 1
  fi
  rm -rf "$DEST"
  ditto "$FOUND_APP" "$DEST"
else
  MOUNT_OUT="$(hdiutil attach "$ASSET" -nobrowse -readonly)"
  MOUNT_POINT="$(echo "$MOUNT_OUT" | awk -F'\t' '/\/Volumes\//{print $NF; exit}')"
  if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
    echo "Failed to mount DMG." >&2
    exit 1
  fi
  FOUND_APP="$(find "$MOUNT_POINT" -maxdepth 2 -name "$APP_NAME" -type d | head -1 || true)"
  if [[ -z "$FOUND_APP" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
    echo "DMG did not contain $APP_NAME" >&2
    exit 1
  fi
  rm -rf "$DEST"
  ditto "$FOUND_APP" "$DEST"
  hdiutil detach "$MOUNT_POINT" -quiet || true
fi

echo "==> Clearing quarantine"
xattr -cr "$DEST" || true
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$DEST" >/dev/null 2>&1 || true
fi

echo "==> Launching Singularity"
open "$DEST"

echo ""
echo "Installed Singularity${VERSION:+ $VERSION} to $DEST"
echo "If macOS blocks it: System Settings → Privacy & Security → Open Anyway"
