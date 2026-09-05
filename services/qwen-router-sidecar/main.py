#!/usr/bin/env python3
"""
Stdio JSON-lines sidecar: Qwen3-1.7B MLX local routing classifier.

Protocol:
  {"id":"qwen_1","op":"classify","text":"..."}
  {"id":"qwen_1","op":"ping"}
  {"id":"...","op":"stats"}

Response:
  {"id":"...","ok":true,"json":"{...}","ttft_ms":N,"generate_ms":N,"tokens":N,"tokens_per_sec":N,"ready":true}
  {"id":"...","ok":false,"error":"not_ready"}

Model is loaded once in a background thread. Classify never loads a new copy.
Thinking mode is disabled. Output is short JSON only.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback

MODEL_ID = os.environ.get("SINGULARITY_QWEN_MODEL", "Qwen/Qwen3-1.7B-MLX-4bit")
MAX_TOKENS = int(os.environ.get("SINGULARITY_QWEN_MAX_TOKENS", "120"))

SYSTEM = (
    "You are Singularity's local engineering-task classifier.\n"
    "Classify the user's engineering request. Do not solve it. Do not recommend a model.\n"
    "Do not explain. Do not output code, diffs, or file edits.\n"
    "Be conservative: software development alone is not high-risk.\n"
    "Output ONLY one JSON object with these keys and allowed values:\n"
    'intent: coding|debugging|refactoring|architecture|testing|explanation|documentation|configuration|research|unknown\n'
    "booleans: investigation_required, security_related, financial_related, production_related, "
    "architecture_related, data_integrity_related, verification_required (true or false)\n"
    "ambiguity: low|medium|high\n"
    "complexity: low|medium|high\n"
    "scope: single_file|single_component|multi_component|repository|system_wide\n"
    "Example:\n"
    '{"intent":"coding","investigation_required":false,"security_related":false,'
    '"financial_related":false,"production_related":false,"architecture_related":false,'
    '"data_integrity_related":false,"ambiguity":"low","complexity":"low",'
    '"scope":"single_file","verification_required":false}'
)

_lock = threading.Lock()
_model = None
_tokenizer = None
_load_error: str | None = None
_load_ms = 0
_ready = False
_stats = {
    "classifications": 0,
    "failures": 0,
    "tokens": 0,
    "generate_ms": 0,
}


def respond(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def load_model() -> None:
    global _model, _tokenizer, _load_error, _load_ms, _ready
    t0 = time.perf_counter()
    try:
        from mlx_lm import load

        model, tokenizer = load(MODEL_ID)
        with _lock:
            _model = model
            _tokenizer = tokenizer
            _load_ms = int((time.perf_counter() - t0) * 1000)
            _ready = True
            _load_error = None
        respond({"ok": True, "ready": True, "op": "loaded", "load_ms": _load_ms, "model": MODEL_ID})
    except Exception as exc:  # noqa: BLE001
        with _lock:
            _load_error = str(exc)
            _ready = False
            _load_ms = int((time.perf_counter() - t0) * 1000)
        respond({"ok": False, "ready": False, "op": "loaded", "error": str(exc), "load_ms": _load_ms})


def classify(text: str) -> dict:
    with _lock:
        model = _model
        tokenizer = _tokenizer
        ready = _ready
        err = _load_error
    if not ready or model is None or tokenizer is None:
        return {"ok": False, "error": err or "not_ready", "ready": False}

    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"{(text or '')[:2000]}\n/no_think"},
    ]
    kwargs = {"tokenize": False, "add_generation_prompt": True}
    try:
        prompt = tokenizer.apply_chat_template(messages, enable_thinking=False, **kwargs)
    except TypeError:
        prompt = tokenizer.apply_chat_template(messages, **kwargs)

    from mlx_lm import generate

    try:
        from mlx_lm.sample_utils import make_sampler

        sampler = make_sampler(temp=0.0)
    except Exception:  # noqa: BLE001
        sampler = None

    t0 = time.perf_counter()
    gen_kwargs = {"max_tokens": MAX_TOKENS, "verbose": False}
    if sampler is not None:
        gen_kwargs["sampler"] = sampler
    else:
        gen_kwargs["temp"] = 0.0

    out = generate(model, tokenizer, prompt=prompt, **gen_kwargs)
    generate_ms = int((time.perf_counter() - t0) * 1000)
    raw = (out or "").strip()
    # First-token time ≈ generation time for tiny JSON; mlx_lm does not expose TTFT.
    tokens = max(1, len(raw.split()))
    tps = (tokens / (generate_ms / 1000)) if generate_ms > 0 else 0.0
    with _lock:
        _stats["classifications"] += 1
        _stats["tokens"] += tokens
        _stats["generate_ms"] += generate_ms
    return {
        "ok": True,
        "ready": True,
        "json": raw,
        "load_ms": _load_ms,
        "ttft_ms": generate_ms,
        "generate_ms": generate_ms,
        "tokens": tokens,
        "tokens_per_sec": round(tps, 2),
    }


def main() -> None:
    threading.Thread(target=load_model, name="qwen-load", daemon=True).start()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            msg = json.loads(line)
            req_id = msg.get("id")
            op = msg.get("op") or "classify"
            if op == "ping":
                respond(
                    {
                        "id": req_id,
                        "ok": True,
                        "pong": True,
                        "ready": _ready,
                        "load_ms": _load_ms,
                        "error": _load_error,
                    }
                )
                continue
            if op == "stats":
                respond({"id": req_id, "ok": True, "ready": _ready, "stats": _stats, "load_ms": _load_ms})
                continue
            if op == "classify":
                result = classify(msg.get("text") or "")
                result["id"] = req_id
                if not result.get("ok"):
                    with _lock:
                        _stats["failures"] += 1
                respond(result)
                continue
            respond({"id": req_id, "ok": False, "error": f"unknown_op:{op}"})
        except Exception as exc:  # noqa: BLE001
            with _lock:
                _stats["failures"] += 1
            respond(
                {
                    "id": req_id,
                    "ok": False,
                    "error": str(exc),
                    "traceback": traceback.format_exc()[-600:],
                }
            )


if __name__ == "__main__":
    main()
