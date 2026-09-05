#!/usr/bin/env bash
# Build Singularity as a macOS .app and wrap it in a single .dmg installer.
#
# Usage:
#   ./scripts/build-dmg.sh              # auto-detect arch (arm64 / x64)
#   VSCODE_ARCH=arm64 ./scripts/build-dmg.sh
#   VSCODE_QUALITY=stable ./scripts/build-dmg.sh
#
# Output:
#   release/out/Singularity-<version>-darwin-<arch>.dmg
#   release/out/Singularity-darwin-<arch>.zip   (for OTA auto-update)
#
# Notes:
# - First run compiles the full VS Code fork (~30–60 min depending on machine).
# - macOS auto-update (Electron autoUpdater) requires a signed + notarized build.
#   Set APPLE_SIGNING_IDENTITY to enable ad-hoc or Developer ID signing.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VSCODE="$ROOT/vscode"
OUT="$ROOT/release/out"

detect_arch() {
  case "$(uname -m)" in
    arm64) echo arm64 ;;
    x86_64) echo x64 ;;
    *) echo "Unsupported macOS arch: $(uname -m)" >&2; exit 1 ;;
  esac
}

export VSCODE_ARCH="${VSCODE_ARCH:-$(detect_arch)}"
export VSCODE_QUALITY="${VSCODE_QUALITY:-stable}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "DMG builds must run on macOS." >&2
  exit 1
fi

echo "==> Singularity macOS build"
echo "    arch=$VSCODE_ARCH quality=$VSCODE_QUALITY"

cd "$ROOT"
if [[ "${SKIP_WORKSPACE_BUILD:-}" != "1" ]]; then
  echo "==> Building workspace packages"
  npm run build:all
else
  echo "==> Skipping workspace build (SKIP_WORKSPACE_BUILD=1)"
fi

cd "$VSCODE"

# VS Code compile/gulp requires Node 24 (see vscode/.nvmrc).
if [[ -f "$VSCODE/.nvmrc" ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    (cd "$VSCODE" && nvm use >/dev/null)
    echo "    node=$(node -v)"
  fi
fi

if [[ ! -d node_modules ]]; then
  echo "==> Installing vscode dependencies (first time only)"
  npm install
fi

echo "==> Compiling Singularity (production minified build)"
npm run gulp "vscode-darwin-${VSCODE_ARCH}-min"

BUILD_PARENT="$(cd "$VSCODE/.." && pwd)"
APP_ROOT="$BUILD_PARENT/VSCode-darwin-${VSCODE_ARCH}"
VERSION="$(node -p "require('./package.json').version")"
COMMIT="$(git -C "$VSCODE" rev-parse HEAD 2>/dev/null || echo unknown)"
APP_NAME="$(node -p "require('./product.json').nameLong")"

if [[ ! -d "$APP_ROOT/${APP_NAME}.app" ]]; then
  echo "Expected app bundle at $APP_ROOT/${APP_NAME}.app" >&2
  exit 1
fi

mkdir -p "$OUT"

# Code signing — ad-hoc by default so the app opens after install.
# Set APPLE_SIGNING_IDENTITY to a Developer ID for notarized releases.
echo "==> Signing app bundle"
"$ROOT/scripts/sign-macos-app.sh" "$APP_ROOT/${APP_NAME}.app"

echo "==> Creating update zip (used by OTA auto-updater)"
ZIP_PATH="$OUT/Singularity-darwin-${VSCODE_ARCH}.zip"
rm -f "$ZIP_PATH"
(
  cd "$APP_ROOT"
  zip -Xry "$ZIP_PATH" "${APP_NAME}.app"
)

echo "==> Generating OTA file manifest and incremental patch (if previous build exists)"
node "$ROOT/scripts/generate-update-artifacts.mjs" \
  --app "$APP_ROOT/${APP_NAME}.app" \
  --version "$VERSION" \
  --arch "$VSCODE_ARCH" \
  --out "$OUT"

echo "==> Creating DMG installer"
DMG_TMP="$OUT/.dmg-build"
mkdir -p "$DMG_TMP"
# create-dmg.ts requires VSCODE_ARCH in the environment
VSCODE_ARCH="$VSCODE_ARCH" VSCODE_QUALITY="$VSCODE_QUALITY" node build/darwin/create-dmg.ts "$BUILD_PARENT" "$DMG_TMP"

RAW_DMG="$DMG_TMP/VSCode-darwin-${VSCODE_ARCH}.dmg"
FINAL_DMG="$OUT/Singularity-${VERSION}-darwin-${VSCODE_ARCH}.dmg"
mv -f "$RAW_DMG" "$FINAL_DMG"

# Write build metadata for publish-update.sh
cat > "$OUT/build-info.json" <<EOF
{
  "version": "$VERSION",
  "commit": "$COMMIT",
  "arch": "$VSCODE_ARCH",
  "quality": "$VSCODE_QUALITY",
  "dmg": "$(basename "$FINAL_DMG")",
  "zip": "$(basename "$ZIP_PATH")",
  "builtAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo ""
echo "Done."
echo "  DMG:  $FINAL_DMG"
echo "  ZIP:  $ZIP_PATH"
echo "  Info: $OUT/build-info.json"
echo ""
echo "Next: upload with ./scripts/publish-update.sh (after configuring Firebase)"
