#!/usr/bin/env bash
# Publish a built Singularity release to GitHub + Firebase OTA manifest.
#
# Prerequisites: gh auth, firebase login, ./scripts/build-dmg.sh already run.
#
# Usage:
#   ./scripts/publish-github-ota.sh
#   MIN_SUPPORTED_VERSION=1.134.0 ./scripts/publish-github-ota.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release/out"
INFO="$OUT/build-info.json"
PATCH_INFO="$OUT/patch-info.json"
MANIFEST_PUBLIC="$ROOT/release/update-server/public/api/releases/manifest.json"
MANIFEST_CURRENT="$ROOT/release/update-server/releases/current.json"

if [[ ! -f "$INFO" ]]; then
  echo "Missing $INFO — run ./scripts/build-dmg.sh first." >&2
  exit 1
fi

VERSION="$(node -p "require('$INFO').version")"
COMMIT="$(node -p "require('$INFO').commit")"
ARCH="$(node -p "require('$INFO').arch")"
QUALITY="$(node -p "require('$INFO').quality")"
DMG_FILE="$(node -p "require('$INFO').dmg")"
ZIP_FILE="$(node -p "require('$INFO').zip")"
MIN_SUPPORTED="${MIN_SUPPORTED_VERSION:-$VERSION}"
TAG="v${VERSION}"
REPO="ashzansoc/singularity-releases"
HOST="https://singularity-ide.web.app"

PATCH_ARGS=()
PATCH_JSON=""
if [[ -f "$PATCH_INFO" ]]; then
  PATCH_FILE="$(node -p "require('$PATCH_INFO').file")"
  PATCH_FROM="$(node -p "require('$PATCH_INFO').fromVersion")"
  PATCH_SIZE="$(node -p "require('$PATCH_INFO').size")"
  PATCH_SHA="$(node -p "require('$PATCH_INFO').sha256")"
  PATCH_COUNT="$(node -p "require('$PATCH_INFO').fileCount")"
  PATCH_ARGS=("$OUT/$PATCH_FILE")
  PATCH_JSON=$(node -e "
const info = require('$PATCH_INFO');
console.log(JSON.stringify({
  fromVersion: info.fromVersion,
  url: 'https://github.com/$REPO/releases/download/$TAG/' + info.file,
  size: info.size,
  sha256: info.sha256,
  fileCount: info.fileCount,
}));
")
  echo "==> Incremental patch: $PATCH_FROM → $VERSION ($PATCH_COUNT files, $(echo "scale=2; $PATCH_SIZE/1024/1024" | bc) MB)"
fi

echo "==> Creating GitHub release $TAG"
NOTES="## Singularity $VERSION

- OTA: full zip + incremental patch (when upgrading from the previous version)
- Install DMG for first-time setup or skipped versions

See prior release notes on GitHub for feature details."

RELEASE_ARGS=(
  "$TAG"
  --repo "$REPO"
  --title "Singularity $VERSION"
  --notes "$NOTES"
  "$OUT/$DMG_FILE"
  "$OUT/$ZIP_FILE"
)
if [[ ${#PATCH_ARGS[@]} -gt 0 ]]; then
  RELEASE_ARGS+=("${PATCH_ARGS[@]}")
fi

gh release create "${RELEASE_ARGS[@]}"

ZIP_URL="https://github.com/$REPO/releases/download/$TAG/$ZIP_FILE"
DMG_URL="https://github.com/$REPO/releases/download/$TAG/$DMG_FILE"

echo "==> Writing OTA manifest"
PATCH_JSON="${PATCH_JSON:-}" node - <<EOF
const fs = require('fs');
const patch = process.env.PATCH_JSON ? JSON.parse(process.env.PATCH_JSON) : null;
const platform = {
  zip: '$ZIP_URL',
  dmg: '$DMG_URL',
};
if (patch) {
  platform.patch = patch;
}
const manifest = {
  latestVersion: '$VERSION',
  minSupportedVersion: '$MIN_SUPPORTED',
  commit: '$COMMIT',
  quality: '$QUALITY',
  mandatory: true,
  releaseNotesUrl: 'https://github.com/$REPO/releases/tag/$TAG',
  platforms: {
    darwin: platform,
    'darwin-arm64': platform,
    'darwin-universal': platform,
  },
};
const json = JSON.stringify(manifest, null, 2) + '\n';
fs.writeFileSync('$MANIFEST_PUBLIC', json);
fs.writeFileSync('$MANIFEST_CURRENT', json);
console.log(json);
EOF

echo "==> Deploying manifest to Firebase Hosting"
(cd "$ROOT/release/update-server" && firebase deploy --only hosting --project singularity-ide --non-interactive)

echo ""
echo "Published Singularity $VERSION"
echo "  Release:  https://github.com/$REPO/releases/tag/$TAG"
echo "  Manifest: $HOST/api/releases/manifest.json"
echo "  Min ver:  $MIN_SUPPORTED"
