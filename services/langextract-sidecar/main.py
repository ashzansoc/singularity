#!/usr/bin/env python3
"""
Stdio JSON-lines sidecar for Google LangExtract.

Protocol (one JSON object per line on stdin):
  {"id":"req_1","op":"extract","text":"...","source_metadata":{...},
   "existing_state_summary":"...","complexity":"simple","config":{...}}

Response (stdout, one JSON line):
  {"id":"req_1","ok":true,"delta":{...},"raw_item_count":N,...}
  {"id":"req_1","ok":false,"error":"..."}

Also supports {"id":"...","op":"ping"} -> {"id":"...","ok":true,"pong":true}
"""

from __future__ import annotations

import json
import sys
import traceback


def respond(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            msg = json.loads(line)
            req_id = msg.get("id")
            op = msg.get("op") or "extract"

            if op == "ping":
                respond({"id": req_id, "ok": True, "pong": True})
                continue

            if op == "extract":
                from extract import run_extract

                result = run_extract(
                    msg.get("text") or "",
                    source_metadata=msg.get("source_metadata"),
                    existing_state_summary=msg.get("existing_state_summary"),
                    config=msg.get("config") or {},
                    complexity=msg.get("complexity") or "simple",
                )
                result["id"] = req_id
                respond(result)
                continue

            respond({"id": req_id, "ok": False, "error": f"unknown_op:{op}"})
        except Exception as exc:  # noqa: BLE001 — sidecar must never die on one request
            respond(
                {
                    "id": req_id,
                    "ok": False,
                    "error": str(exc),
                    "traceback": traceback.format_exc()[-800:],
                }
            )


if __name__ == "__main__":
    main()
