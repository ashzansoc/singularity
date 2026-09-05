#!/usr/bin/env python3
"""Chat dashboard for nvidia/nemotron-3.5-lightning:free via OpenRouter.

  python3 dashboard.py
  open http://127.0.0.1:8765
"""

from __future__ import annotations

import json
import os
import re
import time
from html import escape
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

MODEL_ID = os.environ.get("SINGULARITY_DASH_MODEL", "nvidia/nemotron-3.5-lightning:free")
HOST = os.environ.get("SINGULARITY_QWEN_DASH_HOST", "127.0.0.1")
PORT = int(os.environ.get("SINGULARITY_QWEN_DASH_PORT", "8765"))
OPENROUTER_BASE_URL = (
    os.environ.get("OPENROUTER_BASE_URL")
    or os.environ.get("SINGULARITY_DECISION_BASE_URL")
    or "https://openrouter.ai/api/v1"
).rstrip("/")
OPENROUTER_API_KEY = os.environ.get("SINGULARITY_DECISION_API_KEY") or os.environ.get(
    "OPENROUTER_API_KEY"
)

CLASSIFIER_SYSTEM = (
    "You are Singularity's engineering-task classifier.\n"
    "Classify the user's engineering request. Do not solve it. Do not recommend a model.\n"
    "Do not explain. Do not output code, diffs, or file edits.\n"
    "Be conservative: software development alone is not high-risk.\n"
    "Output ONLY one JSON object with these keys and allowed values:\n"
    "intent: coding|debugging|refactoring|architecture|testing|explanation|"
    "documentation|configuration|research|unknown\n"
    "booleans: investigation_required, security_related, financial_related, "
    "production_related, architecture_related, data_integrity_related, "
    "verification_required (true or false)\n"
    "ambiguity: low|medium|high\n"
    "complexity: low|medium|high\n"
    "scope: single_file|single_component|multi_component|repository|system_wide\n"
    "Example:\n"
    '{"intent":"coding","investigation_required":false,"security_related":false,'
    '"financial_related":false,"production_related":false,"architecture_related":false,'
    '"data_integrity_related":false,"ambiguity":"low","complexity":"low",'
    '"scope":"single_file","verification_required":false}'
)

ROUTER_SYSTEM = Path(__file__).with_name("router_system.txt").read_text(encoding="utf-8")
CHAT_SYSTEM = ROUTER_SYSTEM

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nemotron 3.5 Lightning — test bench</title>
  <style>
    :root {
      --bg: #0e1014;
      --panel: #161a21;
      --line: #2a3140;
      --text: #e8ecf4;
      --muted: #8b95a8;
      --accent: #c9a227;
      --user: #243044;
      --bot: #1c222c;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 { font-size: 15px; font-weight: 600; margin: 0; letter-spacing: 0.01em; }
    h1 span { color: var(--muted); font-weight: 400; }
    .status { color: var(--muted); font-size: 12px; }
    .status.ready { color: #8fd19e; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      background: var(--line);
      border-bottom: 1px solid var(--line);
    }
    .metric {
      background: var(--panel);
      padding: 12px 16px;
    }
    .metric .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    .metric .v { font-size: 22px; font-variant-numeric: tabular-nums; margin-top: 4px; }
    .metric .v small { font-size: 12px; color: var(--muted); }
    .system-wrap {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      padding: 10px 20px 12px;
    }
    .system-wrap label {
      display: block;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
    }
    #system {
      width: 100%;
      min-height: 72px;
      max-height: 200px;
      padding: 10px 12px;
      resize: vertical;
    }
    main { flex: 1; overflow: auto; padding: 20px; }
    .msg {
      max-width: 760px;
      margin: 0 auto 12px;
      padding: 12px 14px;
      border-radius: 10px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg.user { background: var(--user); margin-left: 12%; }
    .msg.bot { background: var(--bot); margin-right: 12%; border: 1px solid var(--line); }
    .msg .who { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
    footer {
      border-top: 1px solid var(--line);
      background: var(--panel);
      padding: 12px 20px 16px;
    }
    .row { max-width: 760px; margin: 0 auto; display: flex; gap: 8px; }
    select, textarea, button {
      font: inherit;
      color: var(--text);
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    select { padding: 8px 10px; }
    textarea {
      flex: 1;
      min-height: 52px;
      max-height: 140px;
      padding: 10px 12px;
      resize: vertical;
    }
    button {
      padding: 0 16px;
      background: var(--accent);
      color: #1a1404;
      border: 0;
      font-weight: 600;
      cursor: pointer;
    }
    button:disabled { opacity: 0.5; cursor: wait; }
  </style>
</head>
<body>
  <header>
    <h1>Nemotron 3.5 Lightning <span>OpenRouter · nvidia/nemotron-3.5-lightning:free</span></h1>
    <div id="status" class="status">connecting…</div>
  </header>
  <section class="metrics">
    <div class="metric"><div class="k">Tokens out</div><div class="v" id="m-tok">—</div></div>
    <div class="metric"><div class="k">TPS</div><div class="v" id="m-tps">— <small>tok/s</small></div></div>
    <div class="metric"><div class="k">TTFT</div><div class="v" id="m-ttft">— <small>ms</small></div></div>
    <div class="metric"><div class="k">Generate</div><div class="v" id="m-gen">— <small>ms</small></div></div>
  </section>
  <div class="system-wrap">
    <label for="system">System instructions</label>
    <textarea id="system">%%ROUTER_SYSTEM%%</textarea>
  </div>
  <main id="log"></main>
  <footer>
    <div class="row">
      <select id="mode">
        <option value="chat">Chat</option>
        <option value="classifier">Classifier JSON</option>
      </select>
      <textarea id="input" placeholder="Type a message — try “what is singularity” or a routing prompt"></textarea>
      <button id="send">Send</button>
    </div>
  </footer>
  <script>
    const log = document.getElementById('log');
    const input = document.getElementById('input');
    const send = document.getElementById('send');
    const status = document.getElementById('status');
    const mode = document.getElementById('mode');
    const system = document.getElementById('system');
    const history = [];
    const saved = localStorage.getItem('nemotron-dash-system-v2');
    if (saved !== null) system.value = saved;
    system.addEventListener('input', () => localStorage.setItem('nemotron-dash-system-v2', system.value));

    function add(role, text) {
      const d = document.createElement('div');
      d.className = 'msg ' + role;
      d.innerHTML = '<div class="who">' + (role === 'user' ? 'You' : 'Nemotron 3.5 Lightning') + '</div>';
      const body = document.createElement('div');
      body.textContent = text;
      d.appendChild(body);
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
      return body;
    }
    async function refreshHealth() {
      try {
        const r = await fetch('/health');
        const j = await r.json();
        if (j.ready) {
          status.textContent = j.model + ' · OpenRouter ready';
          status.classList.add('ready');
        } else {
          status.textContent = j.error || 'missing OpenRouter key';
          status.classList.remove('ready');
        }
      } catch {
        status.textContent = 'dashboard offline';
      }
    }
    async function run() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      add('user', text);
      history.push({ role: 'user', content: text });
      const body = add('bot', '…');
      send.disabled = true;
      try {
        const r = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, mode: mode.value, history, system: system.value }),
        });
        const j = await r.json();
        if (!j.ok) {
          body.textContent = 'Error: ' + (j.error || r.status);
        } else {
          body.textContent = j.output || '';
          history.push({ role: 'assistant', content: j.output || '' });
          document.getElementById('m-tok').childNodes[0].textContent = j.tokens_out + ' ';
          document.getElementById('m-tps').childNodes[0].textContent = j.tps + ' ';
          document.getElementById('m-ttft').childNodes[0].textContent = j.ttft_ms + ' ';
          document.getElementById('m-gen').childNodes[0].textContent = j.generate_ms + ' ';
        }
      } catch (e) {
        body.textContent = String(e);
      } finally {
        send.disabled = false;
        input.focus();
      }
    }
    send.onclick = run;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); }
    });
    refreshHealth();
    setInterval(refreshHealth, 4000);
  </script>
</body>
</html>
"""

HTML = HTML.replace("%%ROUTER_SYSTEM%%", escape(ROUTER_SYSTEM))


def is_router_system(text: str) -> bool:
    t = text.lower()
    return "exactly two choices" in t or "your entire response must be exactly" in t


def coerce_flash_pro(text: str) -> str:
    t = text.replace("<think>", " ").replace("</think>", " ")
    t = re.sub(r"(?is)<think>.*?</think>", " ", t)
    t = t.strip().strip("`\"'").strip()
    low = t.lower()
    if low in ("flash", "pro"):
        return low
    hits = re.findall(r"\b(flash|pro)\b", low)
    if hits:
        return hits[-1]
    return t


def complete(
    message: str,
    mode: str,
    history: list[dict[str, str]],
    system_prompt: str = "",
) -> dict[str, Any]:
    custom = (system_prompt or "").strip()[:16000] or CHAT_SYSTEM
    router = is_router_system(custom)
    if mode == "classifier" and not router:
        messages = [
            {"role": "system", "content": custom or CLASSIFIER_SYSTEM},
            {"role": "user", "content": message[:4000]},
        ]
        max_tokens = 180
        temperature = 0
    else:
        messages: list[dict[str, str]] = [{"role": "system", "content": custom}]
        if router:
            messages.append({"role": "user", "content": message[:4000]})
        else:
            for turn in history[-8:]:
                role = turn.get("role")
                content = (turn.get("content") or "")[:1500]
                if role in ("user", "assistant") and content:
                    messages.append({"role": role, "content": content})
            if not any(m.get("role") == "user" and m.get("content") == message for m in messages[-1:]):
                messages.append({"role": "user", "content": message[:4000]})
        max_tokens = 32 if router else int(os.environ.get("SINGULARITY_QWEN_CHAT_MAX_TOKENS", "512"))
        temperature = 0 if router else 0.7

    payload = {
        "model": MODEL_ID,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
        "reasoning": {"enabled": False, "exclude": True},
        "include_reasoning": False,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        f"{OPENROUTER_BASE_URL}/chat/completions",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://singularity.local",
            "X-Title": "Singularity Nemotron Test Bench",
        },
    )

    t0 = time.perf_counter()
    ttft_ms = 0
    pieces: list[str] = []
    tokens_out = 0
    try:
        with urlopen(req, timeout=60) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data_s = line[5:].strip()
                if data_s == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_s)
                except json.JSONDecodeError:
                    continue
                usage = chunk.get("usage") or {}
                if usage.get("completion_tokens"):
                    tokens_out = int(usage["completion_tokens"])
                delta = ((chunk.get("choices") or [{}])[0].get("delta") or {})
                content = delta.get("content")
                if not content:
                    continue
                if not pieces:
                    ttft_ms = int((time.perf_counter() - t0) * 1000)
                pieces.append(content)
    except HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")[:400]
        return {"ok": False, "error": f"HTTP {e.code}: {err}"}
    except URLError as e:
        return {"ok": False, "error": str(e.reason)}

    generate_ms = int((time.perf_counter() - t0) * 1000)
    output = "".join(pieces).strip()
    if router:
        output = coerce_flash_pro(output)
    if tokens_out <= 0:
        tokens_out = max(1, len(output.split()))
    gen_s = max(generate_ms, 1) / 1000
    tps = tokens_out / gen_s
    return {
        "ok": True,
        "output": output,
        "tokens_out": tokens_out,
        "tps": round(tps, 1),
        "ttft_ms": ttft_ms,
        "generate_ms": generate_ms,
        "model": MODEL_ID,
        "mode": mode,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[nemotron-dash] {fmt % args}", flush=True)

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send(200, HTML.encode("utf-8"), "text/html; charset=utf-8")
            return
        if path == "/health":
            payload = {
                "ready": bool(OPENROUTER_API_KEY),
                "model": MODEL_ID,
                "base": OPENROUTER_BASE_URL,
                "error": None if OPENROUTER_API_KEY else "OPENROUTER_API_KEY missing",
            }
            self._send(200, json.dumps(payload).encode("utf-8"), "application/json")
            return
        self._send(404, b'{"error":"not found"}', "application/json")

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/chat":
            self._send(404, b'{"error":"not found"}', "application/json")
            return
        n = int(self.headers.get("Content-Length") or "0")
        try:
            payload = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send(400, b'{"ok":false,"error":"invalid json"}', "application/json")
            return
        message = str(payload.get("message") or "").strip()
        mode = str(payload.get("mode") or "chat")
        history = payload.get("history") if isinstance(payload.get("history"), list) else []
        system_prompt = str(payload.get("system") or "")
        if not message:
            self._send(400, b'{"ok":false,"error":"empty message"}', "application/json")
            return
        result = complete(message, mode, history, system_prompt)
        self._send(200 if result.get("ok") else 502, json.dumps(result).encode("utf-8"), "application/json")


def main() -> None:
    print(f"[nemotron-dash] {OPENROUTER_BASE_URL} model={MODEL_ID}", flush=True)
    print(f"[nemotron-dash] http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
