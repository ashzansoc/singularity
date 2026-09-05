# Routing classifier sidecar + OpenRouter test dashboard

The stdio sidecar (`main.py`) is optional and unused unless a local MLX model is present.

## Test dashboard (OpenRouter)

Uses `nvidia/nemotron-3.5-lightning:free` with the bundled OpenRouter key and
`https://openrouter.ai/api/v1`.

```bash
python3 dashboard.py
```

Open http://127.0.0.1:8765
