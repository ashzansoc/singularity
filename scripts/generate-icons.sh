#!/usr/bin/env bash
# Regenerate Singularity app / workbench icons from branding assets.
# Prefer singularity-icon.png for Dock / .icns; light/dark logos for in-app theme marks.
# macOS icons use a rounded-rect mask with TRANSPARENT corners (avoids white Dock plate).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/branding/singularity-icon.png}"
if [[ ! -f "$SRC" ]]; then
  SRC="$ROOT/branding/singularity-logo.png"
fi
if [[ ! -f "$SRC" && -f "$ROOT/singularity-icon.png" ]]; then
  SRC="$ROOT/singularity-icon.png"
fi
LIGHT_SRC="$ROOT/branding/singularity-logo-light.png"
DARK_SRC="$ROOT/branding/singularity-logo-dark.png"
VSCODE="$ROOT/vscode"
WORK="$ROOT/.tmp-icons"

if [[ ! -f "$SRC" ]]; then
  echo "Logo not found: $SRC" >&2
  exit 1
fi

command -v magick >/dev/null || { echo "ImageMagick (magick) required" >&2; exit 1; }
command -v iconutil >/dev/null || { echo "iconutil required (macOS)" >&2; exit 1; }

rm -rf "$WORK"
mkdir -p "$WORK/icon.iconset" "$ROOT/branding"

# Dock: macOS template inset (~82% plate) + glyph padding so size matches ChatGPT/WhatsApp.
# Edge-to-edge fills look oversized in the Dock.
CANVAS=1024
PLATE=$(magick identify -format "%[fx:int(${CANVAS} * 0.82)]" xc:none)
GLYPH=$(magick identify -format "%[fx:int(${PLATE} * 0.78)]" xc:none)
RADIUS=$(magick identify -format "%[fx:int(${PLATE} * 0.2237)]" xc:none)
FULL_GLYPH=$(magick identify -format "%[fx:int(${CANVAS} * 0.72)]" xc:none)
FULL_RADIUS=$(magick identify -format "%[fx:int(${CANVAS} * 0.2237)]" xc:none)

magick "$SRC" -resize "${GLYPH}x${GLYPH}" -filter Lanczos \
  -background black -alpha remove -alpha off \
  -gravity center -extent "${PLATE}x${PLATE}" \
  "$WORK/plate.png"

# Dock / .icns: transparent outer margin around squircle
magick -size "${CANVAS}x${CANVAS}" xc:none \
  \( "$WORK/plate.png" \
     \( +clone -alpha transparent -background none -fill white \
        -draw "roundrectangle 0,0 $((PLATE - 1)),$((PLATE - 1)) ${RADIUS},${RADIUS}" \) \
     -alpha off -compose CopyOpacity -composite \) \
  -gravity center -compose over -composite \
  PNG32:"$WORK/art-dock.png"

# Full-bleed plate (win/linux/in-app): glyph inset on black, rounded corners only
magick "$SRC" -resize "${FULL_GLYPH}x${FULL_GLYPH}" -filter Lanczos \
  -background black -alpha remove -alpha off \
  -gravity center -extent "${CANVAS}x${CANVAS}" \
  \( +clone -alpha transparent -background none -fill white \
     -draw "roundrectangle 0,0 $((CANVAS - 1)),$((CANVAS - 1)) ${FULL_RADIUS},${FULL_RADIUS}" \) \
  -alpha off -compose CopyOpacity -composite \
  PNG32:"$WORK/art.png"

[[ "$SRC" -ef "$ROOT/branding/singularity-logo.png" ]] || cp "$SRC" "$ROOT/branding/singularity-logo.png"
[[ "$SRC" -ef "$ROOT/branding/singularity-icon.png" ]] || cp "$SRC" "$ROOT/branding/singularity-icon.png"
cp "$WORK/art-dock.png" "$ROOT/branding/singularity-logo-1024.png"

# Resize dock art (already has transparent outer margin + squircle).
make_masked() {
  local size="$1"
  local out="$2"
  magick "$WORK/art-dock.png" -resize "${size}x${size}" PNG32:"$out"
}

for s in 16 32 128 256 512; do
  make_masked "$s" "$WORK/icon.iconset/icon_${s}x${s}.png"
  make_masked "$((s * 2))" "$WORK/icon.iconset/icon_${s}x${s}@2x.png"
done

iconutil -c icns "$WORK/icon.iconset" -o "$VSCODE/resources/darwin/code.icns"

magick "$WORK/art.png" \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 24x24 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 64x64 \) \
  \( -clone 0 -resize 128x128 \) \
  \( -clone 0 -resize 256x256 \) \
  -delete 0 "$VSCODE/resources/win32/code.ico"

magick "$WORK/art.png" -resize 1024x1024 "$VSCODE/resources/linux/code.png"
magick "$WORK/art.png" -resize 70x70 "$VSCODE/resources/win32/code_70x70.png"
magick "$WORK/art.png" -resize 150x150 "$VSCODE/resources/win32/code_150x150.png"
magick "$WORK/art.png" -resize 192x192 "$VSCODE/resources/server/code-192.png"
magick "$WORK/art.png" -resize 512x512 "$VSCODE/resources/server/code-512.png"
magick "$WORK/art.png" \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  -delete 0 "$VSCODE/resources/server/favicon.ico"

if [[ -d "$VSCODE/resources/linux/rpm" ]]; then
  magick "$WORK/art.png" -resize 128x128 "$VSCODE/resources/linux/rpm/code.xpm"
fi

B64=$(base64 -i "$WORK/art.png" | tr -d '\n')
cat > "$VSCODE/src/vs/workbench/browser/media/code-icon.svg" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="1024" height="1024">
  <image width="1024" height="1024" xlink:href="data:image/png;base64,${B64}"/>
</svg>
EOF

# Theme-aware letterpress + in-app logos (light logo for dark UI, dark logo for light UI)
write_logo_svg() {
  local src="$1"
  local out="$2"
  local size="$3"
  local b64
  magick "$src" -resize "${size}x${size}" "$WORK/tmp-logo.png"
  b64=$(base64 -i "$WORK/tmp-logo.png" | tr -d '\n')
  cat > "$out" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <image width="${size}" height="${size}" xlink:href="data:image/png;base64,${b64}"/>
</svg>
EOF
}

if [[ -f "$LIGHT_SRC" && -f "$DARK_SRC" ]]; then
  cp "$LIGHT_SRC" "$VSCODE/src/vs/workbench/browser/media/singularity-logo-light.png"
  cp "$DARK_SRC" "$VSCODE/src/vs/workbench/browser/media/singularity-logo-dark.png"
  write_logo_svg "$LIGHT_SRC" "$VSCODE/src/vs/workbench/browser/media/singularity-logo-light.svg" 500
  write_logo_svg "$DARK_SRC" "$VSCODE/src/vs/workbench/browser/media/singularity-logo-dark.svg" 500

  magick "$LIGHT_SRC" -resize 260x260 "$WORK/light-260.png"
  magick "$DARK_SRC" -resize 260x260 "$WORK/dark-260.png"
  B64_LIGHT=$(base64 -i "$WORK/light-260.png" | tr -d '\n')
  B64_DARK=$(base64 -i "$WORK/dark-260.png" | tr -d '\n')
  for theme_op in "dark:0.55" "hcDark:0.55"; do
    theme="${theme_op%%:*}"; op="${theme_op##*:}"
    cat > "$VSCODE/src/vs/workbench/browser/parts/editor/media/letterpress-${theme}.svg" <<EOF
<svg width="260" height="260" viewBox="0 0 260 260" opacity="${op}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <image width="260" height="260" xlink:href="data:image/png;base64,${B64_LIGHT}"/>
</svg>
EOF
  done
  for theme_op in "light:0.45" "hcLight:0.45"; do
    theme="${theme_op%%:*}"; op="${theme_op##*:}"
    cat > "$VSCODE/src/vs/workbench/browser/parts/editor/media/letterpress-${theme}.svg" <<EOF
<svg width="260" height="260" viewBox="0 0 260 260" opacity="${op}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <image width="260" height="260" xlink:href="data:image/png;base64,${B64_DARK}"/>
</svg>
EOF
  done

  ASSETS="$VSCODE/extensions/singularity-chat/assets"
  if [[ -d "$ASSETS" ]]; then
    cp "$LIGHT_SRC" "$ASSETS/singularity-logo-light.png"
    cp "$DARK_SRC" "$ASSETS/singularity-logo-dark.png"
    cp "$SRC" "$ASSETS/singularity.png"
    cp "$SRC" "$ASSETS/singularity.png"
  fi
else
  magick "$WORK/art.png" -resize 260x260 "$WORK/letterpress-260.png"
  B64S=$(base64 -i "$WORK/letterpress-260.png" | tr -d '\n')
  for theme_op in "dark:0.35" "light:0.25" "hcDark:0.35" "hcLight:0.25"; do
    theme="${theme_op%%:*}"
    op="${theme_op##*:}"
    cat > "$VSCODE/src/vs/workbench/browser/parts/editor/media/letterpress-${theme}.svg" <<EOF
<svg width="260" height="260" viewBox="0 0 260 260" opacity="${op}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <image width="260" height="260" xlink:href="data:image/png;base64,${B64S}"/>
</svg>
EOF
  done
fi

APP_ICNS="$VSCODE/.build/electron/Singularity.app/Contents/Resources/Singularity.icns"
if [[ -f "$APP_ICNS" ]]; then
  cp "$VSCODE/resources/darwin/code.icns" "$APP_ICNS"
  touch "$VSCODE/.build/electron/Singularity.app"
  touch "$VSCODE/.build/electron/Singularity.app/Contents/Info.plist"
fi

for EXTRA_ICNS in \
  "$ROOT/VSCode-darwin-arm64/Singularity.app/Contents/Resources/Singularity.icns" \
  "$ROOT/VSCode-darwin-arm64/Singularity.app/Contents/Resources/Code.icns"
do
  if [[ -f "$EXTRA_ICNS" ]]; then
    cp "$VSCODE/resources/darwin/code.icns" "$EXTRA_ICNS"
    touch "$(dirname "$EXTRA_ICNS")/../Info.plist" 2>/dev/null || true
  fi
done

rm -rf "$WORK"

echo "Singularity icons regenerated from: $SRC"
echo "macOS icns uses ~18% outer margin + inset glyph (dock size matches peer apps)."
