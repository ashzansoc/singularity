"""Unit tests for delta mapping (no live LLM required)."""

from __future__ import annotations

from types import SimpleNamespace

from extract import extractions_to_delta


def test_extractions_to_delta_requirement_and_prohibition():
    extractions = [
        SimpleNamespace(
            extraction_class="requirement",
            extraction_text="Google login",
            attributes={
                "type": "security",
                "description": "Google authentication",
                "priority": "high",
                "confidence": "0.94",
            },
            char_interval=SimpleNamespace(start_pos=10, end_pos=22),
        ),
        SimpleNamespace(
            extraction_class="prohibition",
            extraction_text="Firebase",
            attributes={"kind": "technology", "confidence": "0.98"},
            char_interval=SimpleNamespace(start_pos=40, end_pos=48),
        ),
        SimpleNamespace(
            extraction_class="supersession",
            extraction_text="instead of MongoDB",
            attributes={
                "kind": "technology",
                "old_text": "MongoDB",
                "new_text": "PostgreSQL",
            },
            char_interval=None,
        ),
    ]
    delta, count = extractions_to_delta(
        extractions, {"type": "conversation", "message_id": "m1"}
    )
    assert count == 3
    assert delta["requirements"][0]["description"] == "Google authentication"
    assert delta["requirements"][0]["source"]["char_start"] == 10
    assert delta["prohibitions"][0]["prohibition"] == "Firebase"
    assert delta["supersessions"][0]["old_text"] == "MongoDB"
