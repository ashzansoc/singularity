#!/usr/bin/env bash
# The agent host resolves @github/singularity-* CLI packages, but npm still
# ships them as @github/copilot-*. Create symlinks so dev builds can start chat.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_MODULES="$ROOT/vscode/node_modules/@github"

if [[ ! -d "$NODE_MODULES" ]]; then
  exit 0
fi

link_if_missing() {
  local target="$1"
  local link="$2"
  if [[ -e "$target" && ! -e "$link" ]]; then
    ln -s "$target" "$link"
    echo "[singularity] Linked @github/$link -> $target"
  fi
}

platform="${PLATFORM:-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)}"
case "$platform" in
  darwin-arm64|darwin-x64|linux-x64|linux-arm64|linuxmusl-x64|linuxmusl-arm64|win32-x64|win32-arm64)
    link_if_missing "copilot-${platform}" "singularity-${platform}"
    ;;
esac

link_if_missing "copilot" "singularity"

write_launcher() {
  local pkg_dir="$1"
  [[ -d "$pkg_dir" ]] || return 0
  local launcher="$pkg_dir/singularity-cli-host"
  [[ -f "$pkg_dir/index.js" ]] || return 0
  cat > "$launcher" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="${SINGULARITY_CLI_NODE:-$(command -v node)}"
exec "$NODE" "$DIR/index.js" "$@"
EOF
  chmod +x "$launcher"
  echo "[singularity] Wrote CLI node launcher in $pkg_dir"
}

case "$platform" in
  darwin-arm64|darwin-x64|linux-x64|linux-arm64|linuxmusl-x64|linuxmusl-arm64|win32-x64|win32-arm64)
    write_launcher "$NODE_MODULES/copilot-${platform}"
    write_launcher "$NODE_MODULES/singularity-${platform}"
    ;;
esac
