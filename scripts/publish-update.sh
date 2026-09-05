#!/usr/bin/env bash
# Upload a built Singularity release to Firebase Storage and publish the OTA manifest.
#
# Prerequisites:
#   npm install -g firebase-tools
#   firebase login
#   firebase use <your-project>   (inside release/update-server)
#   gcloud auth application-default login   (for Storage uploads)
#
# Usage:
#   ./scripts/publish-update.sh
#   MIN_SUPPORTED_VERSION=1.132.0 ./scripts/publish-update.sh
#
# Environment:
#   FIREBASE_PROJECT          Firebase project id (optional if .firebaserc exists)
#   SINGULARITY_PUBLISH_SECRET  Must match Cloud Function env var for /api/admin/publish
#   MIN_SUPPORTED_VERSION     Minimum version users must have (default: latest version)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release/out"
SERVER="$ROOT/release/update-server"
INFO="$OUT/build-info.json"

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

if ! command -v firebase >/dev/null 2>&1; then
  echo "Install Firebase CLI: npm install -g firebase-tools" >&2
  exit 1
fi

cd "$SERVER"
if [[ -n "${FIREBASE_PROJECT:-}" ]]; then
  firebase use "$FIREBASE_PROJECT"
fi

PROJECT="${FIREBASE_PROJECT:-}"
if [[ -z "$PROJECT" && -f .firebaserc ]]; then
  PROJECT="$(node -p "JSON.parse(require('fs').readFileSync('.firebaserc','utf8')).projects?.default||''")"
fi
if [[ -z "$PROJECT" ]]; then
  PROJECT="$(firebase use 2>/dev/null | sed -n 's/^Active Project: \([^ ]*\).*/\1/p' || true)"
fi
if [[ -z "$PROJECT" ]]; then
  echo "No Firebase project selected. Run: cd release/update-server && firebase use <project>" >&2
  exit 1
fi
firebase use "$PROJECT" >/dev/null

BUCKET="${PROJECT}.firebasestorage.app"

echo "==> Deploying update server to Firebase project: $PROJECT"
(cd functions && npm install)
firebase deploy --only functions,hosting,storage

UPLOAD="$SERVER/scripts/upload-release.mjs"
if [[ ! -f "$UPLOAD" ]]; then
  echo "Missing upload script at $UPLOAD" >&2
  exit 1
fi

echo "==> Uploading release artifacts"
(cd "$SERVER/functions" && npm install --silent)
upload() {
  (cd "$SERVER/functions" && FIREBASE_STORAGE_BUCKET="$BUCKET" GOOGLE_CLOUD_PROJECT="$PROJECT" GCLOUD_PROJECT="$PROJECT" node ../scripts/upload-release.mjs "$1" "$2")
}
upload "$OUT/$ZIP_FILE" "releases/${VERSION}/${ZIP_FILE}" > "$OUT/.zip-upload.json"
upload "$OUT/$DMG_FILE" "releases/${VERSION}/${DMG_FILE}" > "$OUT/.dmg-upload.json"

ZIP_URL="$(node -p "require('$OUT/.zip-upload.json').url")"
DMG_URL="$(node -p "require('$OUT/.dmg-upload.json').url")"
HOST="https://${PROJECT}.web.app"

PLATFORM_KEY="darwin"
if [[ "$ARCH" == "arm64" ]]; then
  PLATFORM_KEY="darwin-arm64"
fi

MANIFEST=$(node - <<EOF
const manifest = {
  latestVersion: '$VERSION',
  minSupportedVersion: '$MIN_SUPPORTED',
  commit: '$COMMIT',
  quality: '$QUALITY',
  mandatory: true,
  releaseNotesUrl: '',
  platforms: {
    darwin: { zip: '$ZIP_URL', dmg: '$DMG_URL' },
    'darwin-arm64': { zip: '$ZIP_URL', dmg: '$DMG_URL' },
    'darwin-universal': { zip: '$ZIP_URL', dmg: '$DMG_URL' },
  },
};
console.log(JSON.stringify(manifest, null, 2));
EOF
)

echo "$MANIFEST" > "$SERVER/releases/current.json"

if [[ -n "${SINGULARITY_PUBLISH_SECRET:-}" ]]; then
  echo "==> Publishing manifest via admin API"
  curl -sf -X POST "${HOST}/api/admin/publish" \
    -H "Content-Type: application/json" \
    -H "x-singularity-secret: ${SINGULARITY_PUBLISH_SECRET}" \
    -d "$MANIFEST"
  echo ""
else
  echo "==> Uploading manifest to Storage"
  upload "$SERVER/releases/current.json" "releases/current.json"
fi

echo ""
echo "Published Singularity $VERSION ($COMMIT)"
echo "  Update URL:  $HOST"
echo "  Manifest:    $HOST/api/releases/manifest.json"
echo "  Install:     curl -fsSL $HOST/install.sh | bash"
echo "  Min version: $MIN_SUPPORTED"
echo ""
echo "Update vscode/product.json if needed:"
echo '  "updateUrl": "'"$HOST"'",'
echo '  "singularityUpdateManifestUrl": "'"$HOST"'/api/releases/manifest.json",'
