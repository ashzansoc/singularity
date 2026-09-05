#!/usr/bin/env python3
"""
Agent Framework sidecar stub — health + passthrough protocol for Singularity.

When agent-framework is installed, this module can be extended to build MAF
workflows from Singularity DAG JSON. MVP returns healthy=false so native
scheduler remains the default execution path.
"""

from __future__ import annotations

import json
import sys
from typing import Any


def handle_request(req: dict[str, Any]) -> dict[str, Any]:
    op = req.get("op")
    if op == "health":
        try:
            import agent_framework  # noqa: F401

            return {"ok": True, "substrate": "agent-framework"}
        except ImportError:
            return {"ok": False, "reason": "agent_framework_not_installed"}
    if op == "run_workflow":
        return {
            "ok": False,
            "reason": "not_implemented_use_native",
            "message": "Agent Framework workflow execution not yet wired; use native substrate",
        }
    return {"ok": False, "reason": f"unknown_op:{op}"}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            resp = handle_request(req)
        except Exception as exc:  # noqa: BLE001
            resp = {"ok": False, "reason": str(exc)}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
