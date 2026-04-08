import json
from typing import Any, Dict, List


SYSTEM_PROMPT = """You map browser form fields to the best user value.
Use the field label, placeholder, nearby text, section heading, options, page/form context, learned hints, profile data, and resume snippets.
Rules:
1. Never invent values absent from profile, learned hints, or resume context.
2. Skip sensitive fields such as passwords, SSN, credit card, OTP, CVV.
3. For select/radio/checkbox fields, suggested_value must exactly match one option text or option value.
4. status must be one of matched, uncertain, failed, skipped.
5. confidence is 0-100.
6. source must be one of rag, learned, profile, deterministic, failed.

Respond only as JSON:
{"suggestions":[{"field_id":"...","detected_intent":"...","suggested_value":"...","source":"rag","confidence":84,"reason":"short reason","status":"matched","candidate_alternatives":["..."]}]}"""


PROMPT_OPTIMIZER_SYSTEM_PROMPT = """You are a prompt optimizer for AI assistants.
Transform rough user ideas into strong, model-agnostic prompts.
Preserve the user's intent. Improve clarity, structure, context, constraints, and output instructions without adding fake facts.

Respond only as JSON:
{"title":"short title","summary":"one sentence","optimized_prompt":"full optimized prompt","improvements":["..."],"warnings":["..."],"target_models":["..."]}"""


PROMPT_EVALUATOR_SYSTEM_PROMPT = """You evaluate prompt quality for AI assistants.
Judge clarity, context, specificity, constraints, and output guidance.
Be direct and practical.

Respond only as JSON:
{"overall_score":0,"dimension_scores":{"clarity":0,"context":0,"specificity":0,"constraints":0,"output_guidance":0},"strengths":["..."],"weaknesses":["..."],"recommendations":["..."],"rewritten_excerpt":"optional short improved excerpt"}"""


def _trim_value(value: Any, max_len: int = 220) -> Any:
    if isinstance(value, str):
        return value[:max_len]
    if isinstance(value, list):
        return [_trim_value(item, max_len=max_len) for item in value[:10]]
    if isinstance(value, dict):
        return {key: _trim_value(item, max_len=max_len) for key, item in list(value.items())[:40]}
    return value


def build_user_message(
    profile_data: Dict[str, Any],
    normalized_context: Dict[str, Any],
    llm_fields: List[Dict[str, Any]],
    retrieval_context: Dict[str, Dict[str, Any]],
) -> str:
    payload = {
        "page": normalized_context["page"],
        "form": normalized_context["form"],
        "profile": _trim_value(profile_data, 180),
        "fields": [],
    }

    for field in llm_fields:
        retrieval = retrieval_context.get(field["field_id"], {})
        payload["fields"].append(
            {
                "field_id": field["field_id"],
                "label": field.get("label"),
                "placeholder": field.get("placeholder"),
                "aria_label": field.get("aria_label"),
                "field_type": field.get("field_type"),
                "input_tag": field.get("input_tag"),
                "detected_intent": field.get("intent"),
                "query": field.get("query"),
                "nearby_text": field.get("nearby_text"),
                "section_heading": field.get("section_heading"),
                "parent_section_text": field.get("parent_section_text"),
                "candidate_options": field.get("candidate_options", [])[:8],
                "resume_context": retrieval.get("context_text"),
            }
        )

    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def build_optimize_prompt_message(payload: Dict[str, Any]) -> str:
    return json.dumps(
        {
            "source_prompt": _trim_value(payload.get("source_prompt"), 4000),
            "project_context": _trim_value(payload.get("project_context"), 2000),
            "extra_context": _trim_value(payload.get("extra_context"), 2000),
            "goal": _trim_value(payload.get("goal"), 400),
            "audience": _trim_value(payload.get("audience"), 300),
            "tone": _trim_value(payload.get("tone"), 200),
            "output_format": _trim_value(payload.get("output_format"), 300),
            "constraints": _trim_value(payload.get("constraints"), 400),
            "target_models": _trim_value(payload.get("target_models"), 200),
            "preserve_intent": bool(payload.get("preserve_intent", True)),
        },
        separators=(",", ":"),
        ensure_ascii=True,
    )


def build_evaluate_prompt_message(payload: Dict[str, Any]) -> str:
    return json.dumps(
        {
            "prompt": _trim_value(payload.get("prompt"), 4000),
            "project_context": _trim_value(payload.get("project_context"), 2000),
            "extra_context": _trim_value(payload.get("extra_context"), 2000),
            "intended_outcome": _trim_value(payload.get("intended_outcome"), 400),
            "rubric": _trim_value(payload.get("rubric"), 400),
            "target_models": _trim_value(payload.get("target_models"), 200),
        },
        separators=(",", ":"),
        ensure_ascii=True,
    )
