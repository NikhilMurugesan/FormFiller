from __future__ import annotations

import json
import os
import re
import time
import asyncio
from typing import Any, Dict, List, Tuple
from uuid import uuid4

from dotenv import load_dotenv
from google import genai
from google.genai import types

from .contracts import AnalyzeFieldsResponse, FieldSuggestion
from .normalization import profile_value_for_intent
from .prompt import SYSTEM_PROMPT, build_user_message
from .user_data import get_user_data

load_dotenv()

client = genai.Client()
MODEL_NAME = os.getenv("DEFAULT_MODEL", "gemini-3-flash-preview")
PRICE_PER_1M_PROMPT = 0.075
PRICE_PER_1M_CANDIDATE = 0.30

SENSITIVE_RE = re.compile(r"password|passcode|otp|cvv|cvc|credit.?card|ssn|social.?security", re.I)
MATCHED_THRESHOLD = 80
UNCERTAIN_THRESHOLD = 55
LEARNED_THRESHOLD = 80
MAX_LLM_RETRIES = 2
RETRYABLE_LLM_STATUS_RE = re.compile(r"\b(429|500|502|503|504)\b")


def _trace(message: str, level: str = "INFO") -> None:
    print(f"\n[BACKEND {level}] {message}", flush=True)


def _scalar(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return ", ".join(str(item) for item in value[:12])
    if isinstance(value, dict):
        return ", ".join(f"{key}: {value[key]}" for key in list(value)[:8])
    return str(value)


def _field_text(field: Dict[str, Any]) -> str:
    return " ".join(
        str(item)
        for item in [
            field.get("label"),
            field.get("placeholder"),
            field.get("aria_label"),
            field.get("field_name"),
            field.get("section_heading"),
            field.get("nearby_text"),
        ]
        if item
    )


def resolve_domain_mapping(field: Dict[str, Any], normalized_context: Dict[str, Any]) -> FieldSuggestion | None:
    domain_mappings = normalized_context["learned"]["domain_mappings"] or {}
    profile_data = normalized_context["profile"]["data"] or {}

    for key in [field.get("field_id"), field.get("field_name"), field.get("css_selector")]:
        if not key:
            continue
        profile_key = domain_mappings.get(key)
        if profile_key and profile_data.get(profile_key) not in (None, "", [], {}):
            return FieldSuggestion(
                field_id=field["field_id"],
                label=field.get("label"),
                detected_intent=field.get("intent"),
                suggested_value=_scalar(profile_data[profile_key]),
                source="domain_mapping",
                confidence=97,
                reason=f"domain mapping {profile_key}",
                status="matched",
            )
    return None


def resolve_learned_value(field: Dict[str, Any], normalized_context: Dict[str, Any]) -> FieldSuggestion | None:
    entries = normalized_context["learned"]["entries"] or []
    domain = normalized_context["page"].get("domain")
    intent = field.get("intent")

    if not intent or intent == "unknown":
        return None

    exact = [
        entry
        for entry in entries
        if entry.get("field_id") == field["field_id"] and entry.get("confidence", 0) >= LEARNED_THRESHOLD
    ]
    by_intent = [
        entry
        for entry in entries
        if entry.get("field_intent") == intent
        and entry.get("confidence", 0) >= LEARNED_THRESHOLD
        and entry.get("domain") in {domain, "__global__", None}
    ]
    candidates = exact or by_intent
    if not candidates:
        return None

    candidates.sort(
        key=lambda item: (
            1 if item.get("domain") == domain else 0,
            item.get("confidence", 0),
            item.get("usage_count", 0),
            -item.get("correction_count", 0),
        ),
        reverse=True,
    )
    best = candidates[0]
    return FieldSuggestion(
        field_id=field["field_id"],
        label=field.get("label"),
        detected_intent=intent,
        suggested_value=_scalar(best.get("value")),
        source="learned",
        confidence=min(int(best.get("confidence", 0)), 93),
        reason="learned mapping reused",
        status="matched",
    )


def resolve_deterministic(field: Dict[str, Any], normalized_context: Dict[str, Any]) -> FieldSuggestion | None:
    profile_data = normalized_context["profile"]["data"] or {}
    value = profile_value_for_intent(profile_data, field.get("intent"))
    if value in (None, "", [], {}):
        return None
    return FieldSuggestion(
        field_id=field["field_id"],
        label=field.get("label"),
        detected_intent=field.get("intent"),
        suggested_value=_scalar(value),
        source="deterministic",
        confidence=62,
        reason="profile fallback by intent",
        status="uncertain" if field.get("intent") == "unknown" else "matched",
    )


def resolve_sensitive(field: Dict[str, Any]) -> FieldSuggestion | None:
    text = _field_text(field)
    if SENSITIVE_RE.search(text):
        return FieldSuggestion(
            field_id=field["field_id"],
            label=field.get("label"),
            detected_intent=field.get("intent"),
            suggested_value=None,
            source="failed",
            confidence=0,
            reason="sensitive field skipped",
            status="skipped",
        )
    return None


async def run_llm(
    profile_data: Dict[str, Any],
    normalized_context: Dict[str, Any],
    llm_fields: List[Dict[str, Any]],
    retrieval_context: Dict[str, Dict[str, Any]],
) -> Tuple[List[FieldSuggestion], float]:
    if not llm_fields:
        return [], 0.0

    user_message = build_user_message(profile_data, normalized_context, llm_fields, retrieval_context)
    last_error: Exception | None = None

    for attempt in range(MAX_LLM_RETRIES + 1):
        try:
            response = await client.aio.models.generate_content(
                model=MODEL_NAME,
                contents=user_message,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    temperature=0.0,
                ),
            )

            prompt_tokens = response.usage_metadata.prompt_token_count if response.usage_metadata else 0
            output_tokens = response.usage_metadata.candidates_token_count if response.usage_metadata else 0
            cost = (prompt_tokens / 1_000_000) * PRICE_PER_1M_PROMPT + (output_tokens / 1_000_000) * PRICE_PER_1M_CANDIDATE
            data = json.loads(response.text)
            suggestions = []
            for raw in data.get("suggestions", []):
                try:
                    suggestions.append(FieldSuggestion(**raw))
                except Exception as exc:
                    _trace(f"Invalid LLM suggestion skipped: {exc} | payload={raw}", "WARNING")
            _trace(f"LLM returned {len(suggestions)} suggestion(s). Cost=${cost:.6f}")
            return suggestions, cost
        except Exception as exc:
            last_error = exc
            error_str = str(exc)
            is_retryable = RETRYABLE_LLM_STATUS_RE.search(error_str) is not None
            if attempt < MAX_LLM_RETRIES and is_retryable:
                delay_sec = 2 * (attempt + 1)
                _trace(
                    f"LLM call failed on attempt {attempt + 1}/{MAX_LLM_RETRIES + 1} with retryable error: {error_str}. "
                    f"Retrying in {delay_sec}s.",
                    "WARNING",
                )
                await asyncio.sleep(delay_sec)
                continue

            _trace(f"LLM call failed: {error_str}", "ERROR")
            break

    if last_error:
        _trace(f"Proceeding without LLM suggestions due to upstream failure: {last_error}", "WARNING")
    return [], 0.0


def coerce_llm_suggestion(
    raw: FieldSuggestion,
    field: Dict[str, Any],
    retrieval_context: Dict[str, Dict[str, Any]],
) -> FieldSuggestion:
    status = raw.status
    confidence = int(raw.confidence or 0)
    if status not in {"matched", "uncertain", "failed", "skipped"}:
        status = "matched" if confidence >= MATCHED_THRESHOLD else "uncertain" if confidence >= UNCERTAIN_THRESHOLD else "failed"

    if raw.source not in {"rag", "learned", "profile", "deterministic", "failed"}:
        raw.source = "rag"

    if status == "matched" and confidence < MATCHED_THRESHOLD:
        status = "uncertain"
    if status == "uncertain" and confidence < UNCERTAIN_THRESHOLD:
        status = "failed"

    options = field.get("candidate_options") or []
    if options and raw.suggested_value not in (None, ""):
        allowed_values = {opt.get("value") for opt in options if opt.get("value")}
        allowed_texts = {opt.get("text") for opt in options if opt.get("text")}
        if raw.suggested_value not in allowed_values and raw.suggested_value not in allowed_texts:
            alternatives = sorted(item for item in allowed_texts if item)[:3]
            return FieldSuggestion(
                field_id=field["field_id"],
                label=field.get("label"),
                detected_intent=field.get("intent"),
                suggested_value=None,
                source="failed",
                confidence=0,
                reason="suggested option not present",
                status="failed",
                candidate_alternatives=alternatives,
            )

    return FieldSuggestion(
        field_id=field["field_id"],
        label=field.get("label"),
        detected_intent=raw.detected_intent or field.get("intent"),
        suggested_value=raw.suggested_value,
        source=raw.source,
        confidence=confidence,
        reason=raw.reason or "llm suggestion",
        status=status,
        candidate_alternatives=raw.candidate_alternatives,
    )


async def analyze_form_request(
    normalized_context: Dict[str, Any],
    retrieval_context: Dict[str, Dict[str, Any]],
    debug: bool = False,
) -> AnalyzeFieldsResponse:
    started = time.time()
    request_id = f"req_{uuid4().hex[:12]}"
    profile_data = normalized_context["profile"]["data"] or get_user_data()
    suggestions: List[FieldSuggestion] = []
    debug_fields: List[Dict[str, Any]] = []
    llm_fields: List[Dict[str, Any]] = []

    for field in normalized_context["target_fields"]:
        debug_entry = {
            "field_id": field["field_id"],
            "query": field.get("query"),
            "intent": field.get("intent"),
            "decision_path": [],
            "retrieved_candidates": retrieval_context.get(field["field_id"], {}).get("candidates", []),
        }

        direct = resolve_sensitive(field)
        if direct:
            suggestions.append(direct)
            debug_entry["decision_path"].append("sensitive_skip")
            debug_fields.append(debug_entry)
            continue

        direct = resolve_domain_mapping(field, normalized_context)
        if direct:
            suggestions.append(direct)
            debug_entry["decision_path"].append("domain_mapping")
            debug_fields.append(debug_entry)
            continue

        direct = resolve_learned_value(field, normalized_context)
        if direct:
            suggestions.append(direct)
            debug_entry["decision_path"].append("learned_cache")
            debug_fields.append(debug_entry)
            continue

        llm_fields.append(field)
        debug_entry["decision_path"].append("rag_llm")
        debug_fields.append(debug_entry)

    cost = 0.0
    llm_lookup: Dict[str, FieldSuggestion] = {}
    if llm_fields:
        llm_results, llm_cost = await run_llm(profile_data, normalized_context, llm_fields, retrieval_context)
        cost += llm_cost
        llm_lookup = {
            suggestion.field_id: coerce_llm_suggestion(
                suggestion,
                next(field for field in llm_fields if field["field_id"] == suggestion.field_id),
                retrieval_context,
            )
            for suggestion in llm_results
        }

    for field in llm_fields:
        suggestion = llm_lookup.get(field["field_id"])
        if suggestion:
            suggestions.append(suggestion)
            continue

        fallback = resolve_deterministic(field, normalized_context)
        if fallback:
            suggestions.append(fallback)
            continue

        suggestions.append(
            FieldSuggestion(
                field_id=field["field_id"],
                label=field.get("label"),
                detected_intent=field.get("intent"),
                suggested_value=None,
                source="failed",
                confidence=0,
                reason="no reliable suggestion",
                status="failed",
                candidate_alternatives=[
                    item.get("text") or item.get("value")
                    for item in (field.get("candidate_options") or [])[:3]
                    if item.get("text") or item.get("value")
                ],
            )
        )

    latency = round(time.time() - started, 2)
    ordered = []
    by_id = {suggestion.field_id: suggestion for suggestion in suggestions}
    for field in normalized_context["target_fields"]:
        ordered.append(by_id[field["field_id"]])

    debug_payload = None
    if debug:
        debug_payload = {
            "normalized_request": {
                "page": normalized_context["page"],
                "form": normalized_context["form"],
                "target_field_ids": [field["field_id"] for field in normalized_context["target_fields"]],
            },
            "field_traces": debug_fields,
        }

    return AnalyzeFieldsResponse(
        request_id=request_id,
        suggestions=ordered,
        latency_sec=latency,
        cost_usd=round(cost, 6),
        debug=debug_payload,
    )
