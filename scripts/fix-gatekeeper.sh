#!/bin/bash
# Fix Singularity Gatekeeper block. Paste into Terminal on the Mac that can't open the app.

set -euo pipefail

APP="/Applications/Singularity.app"

echo "==> 1. Check app exists"
if [[ ! -d "$APP" ]]; then
  echo "ERROR: $APP not found."
  echo "Drag Singularity.app from the DMG into Applications first, then run this again."
  exit 1
fi
ls -ld "$APP"
echo

echo "==> 2. Show quarantine / extended attributes (before)"
xattr -lr "$APP" 2>/dev/null | head -40 || true
echo

echo "==> 3. Strip ALL extended attributes (including quarantine)"
# -c clears; -r recurses into the whole .app bundle
xattr -cr "$APP" || true
# Explicitly remove quarantine if anything remains
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo "Done."
echo

echo "==> 4. Attributes after clear (should be empty or only provenance)"
xattr -lr "$APP" 2>/dev/null | head -20 || echo "(none)"
echo

echo "==> 5. Code signature check"
codesign --verify --deep --strict "$APP" 2>&1 || echo "(signature verify failed — may still open after quarantine clear)"
echo

echo "==> 6. Launch with console output"
# Kill any stuck instance
pkill -f "/Applications/Singularity.app/Contents/MacOS/Singularity" 2>/dev/null || true
sleep 1

# Launch binary directly so errors print here instead of vanishing
"$APP/Contents/MacOS/Singularity" 2>&1 &
PID=$!
sleep 3
if kill -0 "$PID" 2>/dev/null; then
  echo "SUCCESS: Singularity is running (pid $PID)."
else
  echo "FAILED: process exited. Last attempt via open:"
  open "$APP" 2>&1 || true
fi
