"""
Singularity LangExtract extraction helpers.
Maps LangExtract grounded extractions into Singularity ExtractionDelta JSON.
"""

from __future__ import annotations

import textwrap
from typing import Any

PROMPT_DESCRIPTION = textwrap.dedent(
    """\
    You are Singularity's project context extraction engine.
    Extract only information that materially affects software development.
    Identify:
    - requirements
    - constraints
    - prohibitions
    - technologies
    - architecture decisions
    - preferences
    - goals
    - open questions
    - entities
    - changes to previous requirements
    Do not invent information.
    Do not convert speculation into requirements.
    Preserve user intent.
    Prefer explicit statements over inference.
    Identify contradictions.
    Every extraction must be grounded in the source text where possible.
    Use exact text for extractions spans. Do not paraphrase source spans.
    Attributes should encode structured fields (type, priority, status, confidence, category, etc.).
    """
)


def build_examples():
    """Few-shot examples for LangExtract (imported lazily to avoid hard dep at import in tests)."""
    import langextract as lx

    return [
        # Example 1 — Requirements
        lx.data.ExampleData(
            text="Build a SaaS dashboard with Google login and Stripe billing.",
            extractions=[
                lx.data.Extraction(
                    extraction_class="goal",
                    extraction_text="SaaS dashboard",
                    attributes={"priority": "high", "confidence": "0.9"},
                ),
                lx.data.Extraction(
                    extraction_class="requirement",
                    extraction_text="Google login",
                    attributes={
                        "type": "security",
                        "description": "Google authentication",
                        "priority": "high",
                        "confidence": "0.94",
                    },
                ),
                lx.data.Extraction(
                    extraction_class="requirement",
                    extraction_text="Stripe billing",
                    attributes={
                        "type": "integration",
                        "description": "Stripe billing",
                        "priority": "high",
                        "confidence": "0.94",
                    },
                ),
            ],
        ),
        # Example 2 — Constraint / prohibition
        lx.data.ExampleData(
            text="Use Next.js and TypeScript. Do not use Firebase.",
            extractions=[
                lx.data.Extraction(
                    extraction_class="technology",
                    extraction_text="Next.js",
                    attributes={"category": "framework", "confidence": "0.95"},
                ),
                lx.data.Extraction(
                    extraction_class="technology",
                    extraction_text="TypeScript",
                    attributes={"category": "language", "confidence": "0.95"},
                ),
                lx.data.Extraction(
                    extraction_class="constraint",
                    extraction_text="Use Next.js and TypeScript",
                    attributes={
                        "kind": "technology",
                        "strength": "hard",
                        "confidence": "0.95",
                    },
                ),
                lx.data.Extraction(
                    extraction_class="prohibition",
                    extraction_text="Firebase",
                    attributes={"kind": "technology", "confidence": "0.98"},
                ),
            ],
        ),
        # Example 3 — Preference
        lx.data.ExampleData(
            text="I'd prefer the UI to feel like Linear.",
            extractions=[
                lx.data.Extraction(
                    extraction_class="preference",
                    extraction_text="feel like Linear",
                    attributes={
                        "category": "ux",
                        "preference": "Linear-like visual style",
                        "confidence": "0.75",
                    },
                ),
            ],
        ),
        # Example 4 — Uncertainty
        lx.data.ExampleData(
            text="Maybe Redis would be useful for caching.",
            extractions=[
                lx.data.Extraction(
                    extraction_class="technology",
                    extraction_text="Redis",
                    attributes={
                        "category": "cache",
                        "status": "proposed",
                        "confidence": "0.3",
                        "source_type": "inferred",
                    },
                ),
            ],
        ),
        # Example 5 — Change
        lx.data.ExampleData(
            text="Actually, let's use PostgreSQL instead of MongoDB.",
            extractions=[
                lx.data.Extraction(
                    extraction_class="technology",
                    extraction_text="PostgreSQL",
                    attributes={
                        "category": "database",
                        "status": "active",
                        "confidence": "0.97",
                    },
                ),
                lx.data.Extraction(
                    extraction_class="decision",
                    extraction_text="use PostgreSQL instead of MongoDB",
                    attributes={
                        "category": "database",
                        "alternatives_rejected": "MongoDB",
                        "confidence": "0.97",
                    },
                ),
                lx.data.Extraction(
                    extraction_class="supersession",
                    extraction_text="instead of MongoDB",
                    attributes={
                        "kind": "technology",
                        "old_text": "MongoDB",
                        "new_text": "PostgreSQL",
                    },
                ),
            ],
        ),
    ]


def _attr(attrs: dict | None, key: str, default: Any = None) -> Any:
    if not attrs:
        return default
    return attrs.get(key, default)


def _float_conf(attrs: dict | None) -> float:
    raw = _attr(attrs, "confidence", "0.8")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.8


def extractions_to_delta(
    extractions: list[Any],
    source_metadata: dict | None,
) -> tuple[dict[str, Any], int]:
    """Normalize LangExtract Extraction objects into Singularity delta."""
    delta: dict[str, Any] = {
        "requirements": [],
        "constraints": [],
        "prohibitions": [],
        "technologies": [],
        "architecture_decisions": [],
        "user_preferences": [],
        "current_goals": [],
        "open_questions": [],
        "entities": [],
        "important_files": [],
        "supersessions": [],
    }

    base_source = {
        "type": (source_metadata or {}).get("type") or "conversation",
        "message_id": (source_metadata or {}).get("message_id"),
        "document_id": (source_metadata or {}).get("document_id"),
        "page": (source_metadata or {}).get("page"),
        "section": (source_metadata or {}).get("section"),
        "file": (source_metadata or {}).get("file"),
        "repository": (source_metadata or {}).get("repository"),
    }

    count = 0
    for e in extractions or []:
        cls = getattr(e, "extraction_class", None) or ""
        text = getattr(e, "extraction_text", None) or ""
        attrs = getattr(e, "attributes", None) or {}
        interval = getattr(e, "char_interval", None)
        source = dict(base_source)
        if interval is not None:
            start = getattr(interval, "start_pos", None)
            end = getattr(interval, "end_pos", None)
            if start is not None:
                source["char_start"] = start
            if end is not None:
                source["char_end"] = end
            source["excerpt"] = text[:200]

        conf = _float_conf(attrs)
        status = _attr(attrs, "status", "active")
        source_type = _attr(attrs, "source_type", "explicit")
        common = {
            "status": status,
            "confidence": conf,
            "source_type": source_type,
            "source": source,
        }

        if cls == "requirement":
            delta["requirements"].append(
                {
                    **common,
                    "type": _attr(attrs, "type", "functional"),
                    "description": _attr(attrs, "description", text),
                    "priority": _attr(attrs, "priority", "medium"),
                }
            )
            count += 1
        elif cls == "constraint":
            delta["constraints"].append(
                {
                    **common,
                    "constraint": text,
                    "kind": _attr(attrs, "kind", "other"),
                    "strength": _attr(attrs, "strength", "hard"),
                }
            )
            count += 1
        elif cls == "prohibition":
            delta["prohibitions"].append(
                {
                    **common,
                    "prohibition": text,
                    "kind": _attr(attrs, "kind", "technology"),
                }
            )
            count += 1
        elif cls == "technology":
            delta["technologies"].append(
                {
                    **common,
                    "name": text,
                    "category": _attr(attrs, "category", "other"),
                    "role": _attr(attrs, "role"),
                }
            )
            count += 1
        elif cls == "decision":
            rejected = _attr(attrs, "alternatives_rejected", [])
            if isinstance(rejected, str):
                rejected = [rejected] if rejected else []
            delta["architecture_decisions"].append(
                {
                    **common,
                    "decision": _attr(attrs, "decision", text),
                    "category": _attr(attrs, "category", "general"),
                    "alternatives_rejected": rejected,
                    "rationale": _attr(attrs, "rationale"),
                }
            )
            count += 1
        elif cls == "preference":
            delta["user_preferences"].append(
                {
                    **common,
                    "preference": _attr(attrs, "preference", text),
                    "category": _attr(attrs, "category", "general"),
                }
            )
            count += 1
        elif cls == "goal":
            delta["current_goals"].append(
                {
                    **common,
                    "goal": text,
                    "priority": _attr(attrs, "priority", "medium"),
                }
            )
            count += 1
        elif cls == "open_question":
            delta["open_questions"].append(
                {
                    **common,
                    "question": text,
                    "related_item_ids": [],
                }
            )
            count += 1
        elif cls == "entity":
            delta["entities"].append(
                {
                    **common,
                    "name": text,
                    "entity_type": _attr(attrs, "entity_type", "other"),
                    "description": _attr(attrs, "description"),
                }
            )
            count += 1
        elif cls == "file":
            delta["important_files"].append(
                {
                    **common,
                    "path": text,
                    "reason": _attr(attrs, "reason"),
                    "related_item_ids": [],
                }
            )
            count += 1
        elif cls == "supersession":
            delta["supersessions"].append(
                {
                    "kind": _attr(attrs, "kind", "technology"),
                    "old_text": _attr(attrs, "old_text", ""),
                    "new_text": _attr(attrs, "new_text", text),
                }
            )
            count += 1

    return delta, count


def run_extract(
    text: str,
    *,
    source_metadata: dict | None,
    existing_state_summary: str | None,
    config: dict | None,
    complexity: str = "simple",
) -> dict[str, Any]:
    """Call LangExtract and return a response dict for the sidecar protocol."""
    import langextract as lx
    from langextract.factory import ModelConfig

    cfg = config or {}
    model_id = cfg.get("model") or "gemini-2.0-flash"
    provider = cfg.get("provider")
    # Map singularity provider name
    if provider in (None, "", "langextract"):
        provider = None  # let langextract route by model_id

    provider_kwargs: dict[str, Any] = {}
    if cfg.get("api_key"):
        provider_kwargs["api_key"] = cfg["api_key"]
    if cfg.get("base_url"):
        provider_kwargs["base_url"] = cfg["base_url"]
        provider_kwargs["model_url"] = cfg["base_url"]

    language_model_params: dict[str, Any] = {}
    if cfg.get("temperature") is not None:
        language_model_params["temperature"] = float(cfg["temperature"])
    if cfg.get("max_output_tokens") is not None:
        language_model_params["max_output_tokens"] = int(cfg["max_output_tokens"])

    prompt = PROMPT_DESCRIPTION
    if existing_state_summary:
        prompt += (
            "\n\nExisting project state (for conflict/supersession detection):\n"
            + existing_state_summary[:4000]
        )

    examples = build_examples()

    model_config_kwargs: dict[str, Any] = {"model_id": model_id}
    if provider:
        # Prefer explicit openai/gemini/ollama when configured
        p = str(provider).lower()
        if p in ("openai", "gemini", "ollama"):
            model_config_kwargs["provider"] = p
        if provider_kwargs:
            model_config_kwargs["provider_kwargs"] = provider_kwargs

    extract_kwargs: dict[str, Any] = {
        "text_or_documents": text,
        "prompt_description": prompt,
        "examples": examples,
        "use_schema_constraints": True,
    }

    if model_config_kwargs.get("provider") or provider_kwargs:
        extract_kwargs["config"] = ModelConfig(**model_config_kwargs)
    else:
        extract_kwargs["model_id"] = model_id
        if provider_kwargs.get("api_key"):
            extract_kwargs["api_key"] = provider_kwargs["api_key"]

    if complexity == "large_document":
        extract_kwargs["max_char_buffer"] = 1000
        extract_kwargs["extraction_passes"] = 2
        extract_kwargs["max_workers"] = 8
        extract_kwargs["context_window_chars"] = 200
    elif complexity == "complex":
        extract_kwargs["extraction_passes"] = 2

    if language_model_params:
        extract_kwargs["language_model_params"] = language_model_params

    result = lx.extract(**extract_kwargs)
    # result may be AnnotatedDocument or list
    docs = result if isinstance(result, list) else [result]
    all_extractions: list[Any] = []
    for doc in docs:
        all_extractions.extend(getattr(doc, "extractions", None) or [])

    # Prefer grounded extractions; keep ungrounded with lower confidence rather than drop all
    grounded = [e for e in all_extractions if getattr(e, "char_interval", None)]
    use = grounded if grounded else all_extractions

    delta, count = extractions_to_delta(use, source_metadata)
    return {
        "ok": True,
        "delta": delta,
        "raw_item_count": count,
        "provider": provider or "langextract",
        "model": model_id,
        "input_tokens": None,
        "output_tokens": None,
    }
