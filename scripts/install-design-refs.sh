#!/usr/bin/env bash
# Install UI reference repos for Singularity Frontend Design Knowledge (Qwen).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REFS="$ROOT/packages/design/refs"
mkdir -p "$REFS"

clone_shallow() {
  local url="$1"
  local dir="$2"
  local target="$REFS/$dir"
  if [[ -d "$target/.git" ]]; then
    echo "↻ updating $dir"
    git -C "$target" fetch --depth 1 origin 2>/dev/null || true
    git -C "$target" reset --hard FETCH_HEAD 2>/dev/null || true
    return 0
  fi
  if [[ -d "$target" ]]; then
    echo "⚠ $dir exists without .git — skipping"
    return 0
  fi
  echo "↓ cloning $dir"
  git clone --depth 1 --single-branch "$url" "$target"
}

echo "Installing Singularity design references → $REFS"

clone_shallow "https://github.com/DavidHDev/react-bits.git" "react-bits"
clone_shallow "https://github.com/shadcn-ui/ui.git" "shadcn-ui"
clone_shallow "https://github.com/arihantcodes/spectrum-ui.git" "spectrum-ui"          # Aceternity + Magic + shadcn collection
clone_shallow "https://github.com/magicuidesign/magicui.git" "magicui"
clone_shallow "https://github.com/radix-ui/primitives.git" "radix-primitives"
clone_shallow "https://github.com/mantinedev/mantine.git" "mantine"
clone_shallow "https://github.com/tremorlabs/tremor.git" "tremor"
clone_shallow "https://github.com/heroui-inc/heroui.git" "heroui"
clone_shallow "https://github.com/nextui-org/nextui.git" "nextui"
clone_shallow "https://github.com/tailwindlabs/headlessui.git" "headlessui"
clone_shallow "https://github.com/shadcn-ui/taxonomy.git" "shadcn-taxonomy"

# Three.js is large — sparse checkout examples only when possible
THREE="$REFS/threejs"
if [[ ! -d "$THREE/.git" ]]; then
  echo "↓ cloning threejs (sparse: examples)"
  git clone --depth 1 --filter=blob:none --sparse "https://github.com/mrdoob/three.js.git" "$THREE"
  git -C "$THREE" sparse-checkout set --skip-checks examples/jsm examples/fonts || true
else
  echo "↻ threejs already present"
fi

echo ""
echo "Design refs ready:"
ls -1 "$REFS" | sed 's/^/  - /'
echo ""
echo "Qwen Frontend Agent can now retrieve live component/layout references."
