#!/usr/bin/env bash
# Ad-hoc or Developer ID sign a Singularity/Electron .app bundle.
#
# Usage:
#   ./scripts/sign-macos-app.sh /path/to/Singularity.app
#   APPLE_SIGNING_IDENTITY="Developer ID Application: ..." ./scripts/sign-macos-app.sh ...
#
# Without APPLE_SIGNING_IDENTITY, signs ad-hoc (identity "-").
# Recipients still need: xattr -cr /Applications/Singularity.app
# Notarization still requires a real Developer ID + notarytool.

set -euo pipefail

APP="${1:?Usage: $0 /path/to/Singularity.app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENT="$ROOT/vscode/build/azure-pipelines/darwin"
IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
# Ad-hoc builds need disable-library-validation so native .node modules load.
if [[ "$IDENTITY" == "-" ]]; then
  APP_ENT="${ROOT}/scripts/adhoc-app-entitlements.plist"
else
  APP_ENT="$ENT/app-entitlements.plist"
fi

if [[ ! -d "$APP" ]]; then
  echo "App bundle not found: $APP" >&2
  exit 1
fi

sign_macho() {
  local file="$1"
  local ent="${2:-}"
  [[ -f "$file" ]] || return 0
  file "$file" | grep -q Mach-O || return 0
  if [[ -n "$ent" && "$IDENTITY" != "-" ]]; then
    codesign --force --sign "$IDENTITY" --options runtime --entitlements "$ent" "$file"
  elif [[ -n "$ent" ]]; then
    codesign --force --sign "$IDENTITY" --entitlements "$ent" "$file"
  elif [[ "$IDENTITY" != "-" ]]; then
    codesign --force --sign "$IDENTITY" --options runtime "$file"
  else
    codesign --force --sign "$IDENTITY" "$file"
  fi
}

echo "==> Signing $(basename "$APP") (identity: ${IDENTITY/-/adhoc})"

# Strip broken linker signatures from Mach-O binaries.
while IFS= read -r -d '' f; do
  file "$f" | grep -q Mach-O && codesign --remove-signature "$f" 2>/dev/null || true
done < <(find "$APP" \( -name "*.dylib" -o -name "*.node" -o -type f -perm +111 \) -print0 2>/dev/null)

# Sign ALL native libs in the bundle (Resources .node modules first).
# Unsigned .node files cause: "Trying to load an unsigned library" on launch.
echo "==> Signing native modules (.node / .dylib)"
while IFS= read -r -d '' f; do
  sign_macho "$f"
done < <(find "$APP" \( -name "*.node" -o -name "*.dylib" \) -type f -print0)

# Sign every Mach-O under Frameworks, deepest paths first (crashpad before Electron Framework).
echo "==> Signing Frameworks"
while IFS= read -r f; do
  sign_macho "$f"
done < <(find "$APP/Contents/Frameworks" -type f | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)

# Sign nested .app helpers (deepest first).
echo "==> Signing helper apps"
while IFS= read -r inner; do
  [[ "$inner" == "$APP" ]] && continue
  name="$(basename "$inner")"
  case "$name" in
    *"Helper (GPU)"*) ent="$ENT/helper-gpu-entitlements.plist" ;;
    *"Helper (Renderer)"*) ent="$ENT/helper-renderer-entitlements.plist" ;;
    *"Helper (Plugin)"*) ent="$ENT/helper-plugin-entitlements.plist" ;;
    *"Helper"*) ent="$ENT/helper-entitlements.plist" ;;
    *) ent="$ENT/app-entitlements.plist" ;;
  esac
  sign_macho "$inner" "$ent"
done < <(find "$APP" -name "*.app" -depth | sort -r)

# Sign main executable and outer bundle.
echo "==> Signing main app"
MAIN="$APP/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
sign_macho "$MAIN" "$APP_ENT"
sign_macho "$APP" "$APP_ENT"

codesign --verify --deep --strict "$APP"
# Spot-check the module that previously broke launches
POLICY="$APP/Contents/Resources/app/node_modules.asar.unpacked/@vscode/policy-watcher/build/Release/vscode-policy-watcher.node"
if [[ -f "$POLICY" ]]; then
  codesign --verify "$POLICY"
fi
echo "==> Signature valid"
