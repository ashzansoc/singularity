#!/usr/bin/env bash
# Build Singularity packages + AI extension, then launch the IDE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export SINGULARITY_ROOT="$ROOT"
export SINGULARITY_AI_ENABLED="${SINGULARITY_AI_ENABLED:-1}"

# Load local secrets (gitignored .env)
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
  echo "[singularity] Loaded .env (OpenRouter: ${OPENROUTER_API_KEY:+yes}, TokenRouter: ${TOKENROUTER_API_KEY:+yes}, GitHub: ${GITHUB_TOKEN:+yes})"
  if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
    echo "[singularity] All models route through OpenRouter (${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1})"
    export VSCODE_AGENT_HOST_BYOK_MODELS_ENABLED=true
  elif [[ -z "${TOKENROUTER_API_KEY:-}" && -f "$HOME/.singularity/deepseek.json" ]]; then
    echo "[singularity] No OPENROUTER_API_KEY — DeepSeek models will use ~/.singularity/deepseek.json @ api.deepseek.com"
  fi
fi

# Context Engine / LangExtract sidecar — ensure venv exists every launch
SIDECAR="$ROOT/services/langextract-sidecar"
SIDECAR_VENV_PY="$SIDECAR/.venv/bin/python"
if [[ ! -x "$SIDECAR_VENV_PY" ]]; then
  echo "[singularity] Installing LangExtract sidecar…"
  bash "$ROOT/scripts/install-langextract-sidecar.sh"
fi
if [[ -x "$SIDECAR_VENV_PY" ]]; then
  export SINGULARITY_CONTEXT_PYTHON="${SINGULARITY_CONTEXT_PYTHON:-$SIDECAR_VENV_PY}"
  export SINGULARITY_CONTEXT_ENGINE="${SINGULARITY_CONTEXT_ENGINE:-true}"
  export SINGULARITY_LANGEXTRACT_ENABLED="${SINGULARITY_LANGEXTRACT_ENABLED:-true}"
  export SINGULARITY_CONTEXT_RETRIEVAL_ENABLED="${SINGULARITY_CONTEXT_RETRIEVAL_ENABLED:-true}"
  export SINGULARITY_CONTEXT_AGENT_INTEGRATION_ENABLED="${SINGULARITY_CONTEXT_AGENT_INTEGRATION_ENABLED:-true}"
  export SINGULARITY_CONTEXT_DEBUG="${SINGULARITY_CONTEXT_DEBUG:-1}"
  export SINGULARITY_NEURAL_RELAY="${SINGULARITY_NEURAL_RELAY:-true}"
  export NEURAL_RELAY_ENABLED="${NEURAL_RELAY_ENABLED:-true}"
  export NEURAL_RELAY_MODEL="${NEURAL_RELAY_MODEL:-nvidia/nemotron-3-nano-30b-a3b:free}"
  export NEURAL_RELAY_CONFIDENCE_HIGH="${NEURAL_RELAY_CONFIDENCE_HIGH:-0.65}"
  export NEURAL_RELAY_CONFIDENCE_LOW="${NEURAL_RELAY_CONFIDENCE_LOW:-0.25}"
  export NEURAL_RELAY_MAX_FILES="${NEURAL_RELAY_MAX_FILES:-8}"
  export SINGULARITY_CONTEXT_WAIT_MS="${SINGULARITY_CONTEXT_WAIT_MS:-22000}"
  # Prefer OpenRouter (already configured) for LangExtract OpenAI-compatible provider
  if [[ -z "${SINGULARITY_CONTEXT_PROVIDER:-}" ]] || [[ "${SINGULARITY_CONTEXT_PROVIDER}" == "langextract" ]]; then
    if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
      export SINGULARITY_CONTEXT_PROVIDER=openai
      export SINGULARITY_CONTEXT_MODEL="${SINGULARITY_CONTEXT_MODEL:-deepseek/deepseek-v4-flash-0731}"
      export SINGULARITY_CONTEXT_BASE_URL="${SINGULARITY_CONTEXT_BASE_URL:-${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}}"
      export OPENAI_API_KEY="${OPENAI_API_KEY:-$OPENROUTER_API_KEY}"
      export LANGEXTRACT_API_KEY="${LANGEXTRACT_API_KEY:-$OPENROUTER_API_KEY}"
    else
      export SINGULARITY_CONTEXT_PROVIDER="${SINGULARITY_CONTEXT_PROVIDER:-langextract}"
      export SINGULARITY_CONTEXT_MODEL="${SINGULARITY_CONTEXT_MODEL:-gemini-2.0-flash}"
    fi
  fi
  # If .env already set openai provider, still wire OpenRouter key for the sidecar
  if [[ "${SINGULARITY_CONTEXT_PROVIDER}" == "openai" && -n "${OPENROUTER_API_KEY:-}" ]]; then
    export OPENAI_API_KEY="${OPENAI_API_KEY:-$OPENROUTER_API_KEY}"
    export LANGEXTRACT_API_KEY="${LANGEXTRACT_API_KEY:-$OPENROUTER_API_KEY}"
    export SINGULARITY_CONTEXT_BASE_URL="${SINGULARITY_CONTEXT_BASE_URL:-${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}}"
  fi
  echo "[singularity] Context Engine ON (python=$SINGULARITY_CONTEXT_PYTHON, provider=${SINGULARITY_CONTEXT_PROVIDER}, model=${SINGULARITY_CONTEXT_MODEL})"
  echo "[singularity] Neural Relay ON (model=${NEURAL_RELAY_MODEL}, maxFiles=${NEURAL_RELAY_MAX_FILES}, wait=${SINGULARITY_CONTEXT_WAIT_MS}ms)"
else
  echo "[singularity] WARNING: LangExtract sidecar python missing — Context Engine will use heuristic fallback"
fi

# VS Code built-in extension sync hits GitHub API; unauthenticated requests rate-limit quickly.
if [[ -z "${GITHUB_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  if GITHUB_TOKEN="$(gh auth token 2>/dev/null)" && [[ -n "$GITHUB_TOKEN" ]]; then
    export GITHUB_TOKEN
    echo "[singularity] Using GitHub token from \`gh auth token\` for built-in extension downloads"
  fi
fi
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "[singularity] WARNING: GITHUB_TOKEN unset — built-in extension sync may fail with GitHub 403 rate limits"
  echo "[singularity]          Set GITHUB_TOKEN in .env or run \`gh auth login\`"
fi

echo "[singularity] Building packages + extension…"
bash "$ROOT/scripts/build-all.sh"

echo "[singularity] Ensuring Singularity CLI shims…"
bash "$ROOT/scripts/ensure-singularity-cli-shims.sh"

echo "[singularity] Launching…"
cd "$ROOT/vscode"

# VS Code compile/gulp requires Node 24 (see vscode/.nvmrc).
if [[ -f "$ROOT/vscode/.nvmrc" ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm use >/dev/null
  fi
fi

exec ./scripts/code.sh "$@"
