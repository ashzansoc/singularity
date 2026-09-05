#!/bin/bash
# Install Singularity and clear Gatekeeper quarantine so the app can open.
# Double-click this from the DMG (or run it in Terminal).

set -euo pipefail

APP_NAME="Singularity.app"
DEST="/Applications/${APP_NAME}"

# Resolve DMG mount that contains this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${SCRIPT_DIR}/${APP_NAME}"

if [[ ! -d "$SRC" ]]; then
  osascript -e 'display dialog "Could not find Singularity.app next to this installer. Open the Singularity DMG and run Install Singularity.command from that window." buttons {"OK"} default button 1 with icon stop'
  exit 1
fi

osascript -e 'display dialog "This will install Singularity to Applications and clear macOS Gatekeeper quarantine so it can open.\n\nYou may be asked for your password." buttons {"Cancel", "Install"} default button "Install"' >/dev/null || exit 0

echo "Installing ${APP_NAME} to /Applications..."
rm -rf "$DEST"
ditto "$SRC" "$DEST"

echo "Clearing quarantine attributes..."
xattr -cr "$DEST" || true

echo "Opening Singularity..."
open "$DEST"

osascript -e 'display dialog "Singularity was installed to Applications and opened.\n\nIf macOS still blocks it: System Settings → Privacy & Security → scroll down → Open Anyway." buttons {"OK"} default button 1'
