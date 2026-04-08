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

from .contracts import (
    AnalyzeFieldsResponse,
    EvaluatePromptRequest,
    EvaluatePromptResponse,
    FieldSuggestion,
    OptimizePromptRequest,
    OptimizePromptResponse,
)
from .normalization import flatten_profile_data, profile_value_for_intent
from .prompt import (
    PROMPT_EVALUATOR_SYSTEM_PROMPT,
    PROMPT_OPTIMIZER_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    build_evaluate_prompt_message,
    build_optimize_prompt_message,
    build_user_message,
)
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
MATCHABLE_TAGS = {"select", "radio", "checkbox"}
OPTION_PLACEHOLDER_RE = re.compile(r"^(?:--+\s*)?(select|choose|pick|option|please select|please choose)\b", re.I)
WORD_RE = re.compile(r"[a-z0-9]+")

STATE_ABBREVIATIONS = {
    "andhra pradesh": "AP", "arunachal pradesh": "AR", "assam": "AS", "bihar": "BR", "chhattisgarh": "CG",
    "goa": "GA", "gujarat": "GJ", "haryana": "HR", "himachal pradesh": "HP", "jharkhand": "JH",
    "karnataka": "KA", "kerala": "KL", "madhya pradesh": "MP", "maharashtra": "MH", "manipur": "MN",
    "meghalaya": "ML", "mizoram": "MZ", "nagaland": "NL", "odisha": "OD", "punjab": "PB",
    "rajasthan": "RJ", "sikkim": "SK", "tamil nadu": "TN", "telangana": "TS", "tripura": "TR",
    "uttar pradesh": "UP", "uttarakhand": "UK", "west bengal": "WB",
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA",
    "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
    "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}
COUNTRY_CODES = {
    "india": "IN", "united states": "US", "united states of america": "US", "usa": "US", "united kingdom": "GB",
    "uk": "GB", "canada": "CA", "australia": "AU", "germany": "DE", "france": "FR", "japan": "JP",
    "china": "CN", "brazil": "BR", "mexico": "MX", "singapore": "SG", "south korea": "KR", "italy": "IT",
    "spain": "ES", "netherlands": "NL", "switzerland": "CH", "sweden": "SE", "norway": "NO", "denmark": "DK",
    "ireland": "IE", "new zealand": "NZ", "south africa": "ZA", "united arab emirates": "AE", "uae": "AE",
    "saudi arabia": "SA", "israel": "IL", "taiwan": "TW", "hong kong": "HK", "malaysia": "MY",
    "indonesia": "ID", "philippines": "PH", "thailand": "TH", "vietnam": "VN", "poland": "PL",
    "belgium": "BE", "austria": "AT", "czech republic": "CZ", "portugal": "PT", "finland": "FI",
    "russia": "RU", "sri lanka": "LK", "pakistan": "PK", "bangladesh": "BD", "nepal": "NP",
}
DEGREE_SYNONYMS = {
    "bachelor's degree": {"bachelors", "bachelor", "bsc", "ba", "btech", "be", "undergraduate", "ug"},
    "master's degree": {"masters", "master", "msc", "ma", "mtech", "mba", "ms", "postgraduate", "pg"},
    "doctoral degree": {"phd", "doctorate", "doctoral", "dphil"},
    "associate's degree": {"associates", "associate", "aa", "as"},
    "high school diploma": {"high school", "hsc", "12th", "12th grade", "ged"},
}
YES_NO_SYNONYMS = {
    "yes": {"yes", "y", "true", "1", "authorized", "available", "eligible"},
    "no": {"no", "n", "false", "0", "not authorized", "not available"},
}


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


def _norm(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _tokens(value: Any) -> set[str]:
    return set(WORD_RE.findall(_norm(value)))


def _levenshtein(a: str, b: str) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)

    prev = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        curr = [i]
        for j, char_b in enumerate(b, start=1):
            cost = 0 if char_a == char_b else 1
            curr.append(min(curr[-1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def _similarity(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    length = max(len(a), len(b))
    if length == 0:
        return 1.0
    return 1.0 - (_levenshtein(a, b) / length)


def _token_overlap(a: Any, b: Any) -> float:
    left = _tokens(a)
    right = _tokens(b)
    if not left or not right:
        return 0.0
    return len(left & right) / max(len(left), len(right))


def _deep_merge_profiles(base: Any, override: Any) -> Any:
    if isinstance(base, dict) and isinstance(override, dict):
        merged = dict(base)
        for key, value in override.items():
            if value in (None, "", [], {}):
                continue
            merged[key] = _deep_merge_profiles(base.get(key), value)
        return merged
    return override if override not in (None, "", [], {}) else base


def _get_profile_data(normalized_context: Dict[str, Any]) -> Dict[str, Any]:
    return normalized_context["profile"].get("merged_data") or normalized_context["profile"].get("data") or {}


def _get_flat_profile_data(normalized_context: Dict[str, Any]) -> Dict[str, Any]:
    return normalized_context["profile"].get("merged_flat_data") or normalized_context["profile"].get("flat_data") or {}


def _is_option_field(field: Dict[str, Any]) -> bool:
    if field.get("candidate_options"):
        return True
    field_type = (field.get("field_type") or "").lower()
    input_tag = (field.get("input_tag") or "").lower()
    return field_type in MATCHABLE_TAGS or input_tag in MATCHABLE_TAGS


def _valid_options(field: Dict[str, Any]) -> List[Dict[str, Any]]:
    valid: List[Dict[str, Any]] = []
    for option in field.get("candidate_options") or []:
        text = (option.get("text") or "").strip()
        value = (option.get("value") or "").strip()
        if not text and not value:
            continue
        label = text or value
        if OPTION_PLACEHOLDER_RE.search(label):
            continue
        if option.get("disabled"):
            continue
        valid.append(option)
    return valid


def _option_output_value(option: Dict[str, Any]) -> str | None:
    return option.get("text") or option.get("value")


def _boolish(value: Any) -> str | None:
    if isinstance(value, bool):
        return "yes" if value else "no"
    normalized = _norm(value)
    if normalized in YES_NO_SYNONYMS["yes"]:
        return "yes"
    if normalized in YES_NO_SYNONYMS["no"]:
        return "no"
    return None


def _canonical_variants(value: Any, field: Dict[str, Any], candidate_key: str | None = None) -> List[str]:
    variants: List[str] = []
    intent = field.get("intent")
    text = _scalar(value)
    if text not in (None, ""):
        variants.append(str(text))

    boolish = _boolish(value)
    if boolish:
        variants.append(boolish)

    normalized_key = _norm(candidate_key)
    normalized_text = _norm(text)
    authorization_source = normalized_key.startswith("intent work_authorization") or "work authorization" in normalized_key or "authorized to work" in normalized_key
    sponsorship_source = normalized_key.startswith("intent sponsorship") or "sponsorship" in normalized_key
    if authorization_source:
        if normalized_text and normalized_text not in {"no", "false"}:
            variants.append("yes")
    if sponsorship_source:
        if boolish:
            variants.append(boolish)
        elif normalized_text:
            if any(token in normalized_text for token in ("not required", "no", "citizen", "permanent resident")):
                variants.append("no")
            if any(token in normalized_text for token in ("required", "yes", "need sponsor", "requires sponsor", "h1b")):
                variants.append("yes")

    seen = set()
    ordered: List[str] = []
    for item in variants:
        normalized_item = _norm(item)
        if not normalized_item or normalized_item in seen:
            continue
        seen.add(normalized_item)
        ordered.append(str(item))
    return ordered


def _synonym_match_score(target_norm: str, option_norm: str, field_intent: str | None) -> int:
    if not target_norm or not option_norm:
        return 0

    if target_norm in YES_NO_SYNONYMS["yes"] and option_norm in YES_NO_SYNONYMS["yes"]:
        return 86
    if target_norm in YES_NO_SYNONYMS["no"] and option_norm in YES_NO_SYNONYMS["no"]:
        return 86

    if field_intent in {"state", "unknown", None}:
        state_code = _norm(STATE_ABBREVIATIONS.get(target_norm))
        if state_code and option_norm == state_code:
            return 85
        for full_name, abbrev in STATE_ABBREVIATIONS.items():
            if option_norm == _norm(full_name) and target_norm == _norm(abbrev):
                return 85

    if field_intent in {"country", "unknown", None}:
        country_code = _norm(COUNTRY_CODES.get(target_norm))
        if country_code and option_norm == country_code:
            return 85
        for full_name, code in COUNTRY_CODES.items():
            if option_norm == _norm(full_name) and target_norm == _norm(code):
                return 85

    if field_intent in {"education_level", "unknown", None}:
        for canonical, variants in DEGREE_SYNONYMS.items():
            all_terms = {_norm(canonical), *(_norm(item) for item in variants)}
            if target_norm in all_terms and option_norm in all_terms:
                return 84

    return 0


def _match_option_value(field: Dict[str, Any], raw_value: Any, candidate_key: str | None = None) -> Dict[str, Any] | None:
    options = _valid_options(field)
    if not options:
        return None

    field_intent = field.get("intent")
    best: Dict[str, Any] | None = None
    for target in _canonical_variants(raw_value, field, candidate_key):
        target_raw = str(target).strip()
        target_norm = _norm(target_raw)
        if not target_norm:
            continue

        for option in options:
            text = (option.get("text") or "").strip()
            value = (option.get("value") or "").strip()
            label = text or value
            if not label:
                continue

            comparisons = [item for item in [text, value, label] if item]
            score = 0
            match_type = ""

            for item in comparisons:
                item_norm = _norm(item)
                if not item_norm:
                    continue
                if item == target_raw:
                    score = max(score, 98)
                    match_type = match_type or "exact"
                elif item.lower() == target_raw.lower():
                    score = max(score, 95)
                    match_type = match_type or "case_insensitive"
                elif item_norm == target_norm:
                    score = max(score, 92)
                    match_type = match_type or "normalized"

                synonym_score = _synonym_match_score(target_norm, item_norm, field_intent)
                if synonym_score > score:
                    score = synonym_score
                    match_type = f"synonym_{field_intent or 'generic'}"

                if target_norm and item_norm and len(target_norm) >= 4 and len(item_norm) >= 4:
                    overlap = _token_overlap(target_norm, item_norm)
                    if overlap >= 0.75 and overlap * 80 > score:
                        score = int(round(overlap * 80))
                        match_type = "token_overlap"

                    if target_norm in item_norm or item_norm in target_norm:
                        partial = int(round((min(len(target_norm), len(item_norm)) / max(len(target_norm), len(item_norm))) * 76))
                        if partial > score:
                            score = partial
                            match_type = "partial"

                    sim = _similarity(target_norm, item_norm)
                    if sim >= 0.87 and int(round(sim * 82)) > score:
                        score = int(round(sim * 82))
                        match_type = "fuzzy"

            if not best or score > best["confidence"]:
                best = {
                    "confidence": score,
                    "match_type": match_type or "none",
                    "option_text": text,
                    "option_value": value,
                    "resolved_value": _option_output_value(option),
                    "candidate_value": target_raw,
                    "candidate_key": candidate_key,
                }

    return best if best and best["confidence"] > 0 else None


def _candidate_key_relevance(field: Dict[str, Any], key: str) -> int:
    key_norm = _norm(key.replace(".", " "))
    field_text = _field_text(field)
    score = 0
    if field.get("intent") and field.get("intent") != "unknown" and field.get("intent") in key_norm.replace(" ", "_"):
        score += 10
    overlap = _token_overlap(field_text, key_norm)
    score += int(round(overlap * 12))
    return min(score, 14)


def _expand_profile_values(raw: Any) -> List[Any]:
    if raw in (None, "", [], {}):
        return []
    if isinstance(raw, list):
        values = list(raw[:10])
        if raw:
            values.append(", ".join(str(item) for item in raw[:10]))
        return values
    return [raw]


def _candidate_allowed_for_field(field: Dict[str, Any], key: str, value: Any) -> bool:
    intent = field.get("intent")
    boolish = _boolish(value)
    if boolish is None:
        return True

    normalized_key = _norm(key)
    intent_key_hints = {
        "work_authorization": ("work authorization", "authorized to work", "work_authorization"),
        "sponsorship": ("sponsorship", "visa", "sponsor"),
        "relocation": ("relocation", "relocate"),
        "remote_preference": ("remote", "hybrid", "work mode", "on site"),
    }
    hints = intent_key_hints.get(intent)
    if not hints:
        return True
    return any(hint in normalized_key for hint in hints)


def _resolve_option_suggestion(
    field: Dict[str, Any],
    raw_value: Any,
    *,
    source: str,
    base_confidence: int,
    reason: str,
    detected_intent: str | None = None,
) -> FieldSuggestion:
    if raw_value in (None, "", [], {}):
        return FieldSuggestion(
            field_id=field["field_id"],
            label=field.get("label"),
            detected_intent=detected_intent or field.get("intent"),
            suggested_value=None,
            source="failed",
            confidence=0,
            reason="no usable value",
            status="failed",
        )

    suggested_value = _scalar(raw_value)
    confidence = int(base_confidence)
    if _is_option_field(field):
        match = _match_option_value(field, raw_value)
        if not match or not match.get("resolved_value"):
            return FieldSuggestion(
                field_id=field["field_id"],
                label=field.get("label"),
                detected_intent=detected_intent or field.get("intent"),
                suggested_value=None,
                source="failed",
                confidence=0,
                reason="suggested option not present",
                status="failed",
                candidate_alternatives=[
                    item.get("text") or item.get("value")
                    for item in _valid_options(field)[:3]
                    if item.get("text") or item.get("value")
                ],
            )
        suggested_value = match["resolved_value"]
        confidence = min(99, int(round((base_confidence * 0.35) + (match["confidence"] * 0.65))))
        reason = f"{reason}; option={match['option_text'] or match['option_value']} ({match['match_type']})"

    status = "matched" if confidence >= MATCHED_THRESHOLD else "uncertain" if confidence >= UNCERTAIN_THRESHOLD else "failed"
    return FieldSuggestion(
        field_id=field["field_id"],
        label=field.get("label"),
        detected_intent=detected_intent or field.get("intent"),
        suggested_value=suggested_value,
        source=source,
        confidence=confidence,
        reason=reason,
        status=status,
    )


def resolve_dropdown_from_profile_pool(field: Dict[str, Any], normalized_context: Dict[str, Any]) -> FieldSuggestion | None:
    if not _is_option_field(field):
        return None

    options = _valid_options(field)
    if not options:
        return None

    profile_data = _get_profile_data(normalized_context)
    request_flat = normalized_context["profile"].get("flat_data") or {}
    merged_flat = _get_flat_profile_data(normalized_context)
    candidates: List[Dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    direct_value = profile_value_for_intent(profile_data, field.get("intent"))
    for value in _expand_profile_values(direct_value):
        key = f"intent:{field.get('intent')}"
        signature = (key, _norm(value))
        if signature[1] and signature not in seen:
            seen.add(signature)
            candidates.append({"key": key, "value": value, "boost": 16, "source": "intent"})

    for source_name, flat_map, source_boost in (
        ("profile", request_flat, 10),
        ("merged", merged_flat, 5),
    ):
        for key, raw in flat_map.items():
            for value in _expand_profile_values(raw):
                if not _candidate_allowed_for_field(field, key, value):
                    continue
                signature = (key, _norm(value))
                if not signature[1] or signature in seen:
                    continue
                seen.add(signature)
                candidates.append(
                    {
                        "key": key,
                        "value": value,
                        "boost": source_boost + _candidate_key_relevance(field, key),
                        "source": source_name,
                    }
                )

    ranked: List[Dict[str, Any]] = []
    for candidate in candidates:
        match = _match_option_value(field, candidate["value"], candidate["key"])
        if not match:
            continue
        final_confidence = min(99, match["confidence"] + candidate["boost"])
        ranked.append(
            {
                **candidate,
                **match,
                "final_confidence": final_confidence,
            }
        )

    if not ranked:
        return None

    ranked.sort(key=lambda item: (item["final_confidence"], item["confidence"]), reverse=True)
    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else None
    status = "matched"
    if best["final_confidence"] < MATCHED_THRESHOLD:
        if best["final_confidence"] < UNCERTAIN_THRESHOLD:
            return None
        status = "uncertain"
    if second and second["resolved_value"] != best["resolved_value"] and second["final_confidence"] >= best["final_confidence"] - 2:
        status = "uncertain"

    return FieldSuggestion(
        field_id=field["field_id"],
        label=field.get("label"),
        detected_intent=field.get("intent"),
        suggested_value=best["resolved_value"],
        source="profile",
        confidence=best["final_confidence"],
        reason=f"profile pool {best['key']} -> {best['option_text'] or best['option_value']} ({best['match_type']})",
        status=status,
        candidate_alternatives=[
            item["resolved_value"]
            for item in ranked[1:4]
            if item["resolved_value"] and item["resolved_value"] != best["resolved_value"]
        ],
    )


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
    profile_data = _get_profile_data(normalized_context)

    for key in [field.get("field_id"), field.get("field_name"), field.get("css_selector")]:
        if not key:
            continue
        profile_key = domain_mappings.get(key)
        if profile_key and profile_data.get(profile_key) not in (None, "", [], {}):
            return _resolve_option_suggestion(
                field,
                profile_data[profile_key],
                source="domain_mapping",
                base_confidence=97,
                reason=f"domain mapping {profile_key}",
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
    return _resolve_option_suggestion(
        field,
        best.get("value"),
        source="learned",
        base_confidence=min(int(best.get("confidence", 0)), 93),
        reason="learned mapping reused",
        detected_intent=intent,
    )


def resolve_deterministic(field: Dict[str, Any], normalized_context: Dict[str, Any]) -> FieldSuggestion | None:
    profile_data = _get_profile_data(normalized_context)
    value = profile_value_for_intent(profile_data, field.get("intent"))
    if value in (None, "", [], {}):
        return None
    return _resolve_option_suggestion(
        field,
        value,
        source="deterministic",
        base_confidence=62,
        reason="profile fallback by intent",
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


def _calculate_response_cost(response: Any) -> float:
    prompt_tokens = response.usage_metadata.prompt_token_count if response.usage_metadata else 0
    output_tokens = response.usage_metadata.candidates_token_count if response.usage_metadata else 0
    return (prompt_tokens / 1_000_000) * PRICE_PER_1M_PROMPT + (output_tokens / 1_000_000) * PRICE_PER_1M_CANDIDATE


def _parse_json_payload(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _normalize_text_list(value: Any, *, max_items: int = 6) -> List[str]:
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, list):
        items = value
    else:
        return []

    output: List[str] = []
    for item in items:
        text = str(item).strip()
        if text and text not in output:
            output.append(text)
        if len(output) >= max_items:
            break
    return output


def _context_items_payload(items: List[Any]) -> List[Dict[str, Any]]:
    serialized: List[Dict[str, Any]] = []
    for item in items or []:
        if hasattr(item, "model_dump"):
            raw = item.model_dump()
        elif isinstance(item, dict):
            raw = item
        else:
            continue
        content = str(raw.get("content") or "").strip()
        if not content:
            continue
        serialized.append(
            {
                "context_id": raw.get("context_id"),
                "role": raw.get("role"),
                "title": raw.get("title"),
                "content": content,
                "tags": raw.get("tags") or [],
            }
        )
    return serialized


async def _run_json_llm(
    user_message: str,
    system_instruction: str,
    *,
    log_label: str,
    temperature: float = 0.0,
) -> Tuple[Dict[str, Any] | None, float]:
    last_error: Exception | None = None

    for attempt in range(MAX_LLM_RETRIES + 1):
        try:
            response = await client.aio.models.generate_content(
                model=MODEL_NAME,
                contents=user_message,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    temperature=temperature,
                ),
            )
            cost = _calculate_response_cost(response)
            data = _parse_json_payload(response.text or "{}")
            return data, cost
        except Exception as exc:
            last_error = exc
            error_str = str(exc)
            is_retryable = RETRYABLE_LLM_STATUS_RE.search(error_str) is not None
            if attempt < MAX_LLM_RETRIES and is_retryable:
                delay_sec = 2 * (attempt + 1)
                _trace(
                    f"{log_label} failed on attempt {attempt + 1}/{MAX_LLM_RETRIES + 1} with retryable error: "
                    f"{error_str}. Retrying in {delay_sec}s.",
                    "WARNING",
                )
                await asyncio.sleep(delay_sec)
                continue

            _trace(f"{log_label} failed: {error_str}", "ERROR")
            break

    if last_error:
        _trace(f"{log_label} unavailable after retries: {last_error}", "WARNING")
    return None, 0.0


def _fallback_optimized_prompt(request: OptimizePromptRequest) -> str:
    output_format = _norm(request.output_format)
    wants_direct_prompt = any(
        marker in output_format
        for marker in ("direct prompt", "plain prompt", "single prompt", "prompt only", "direct rewrite")
    )
    wants_light_touch = (
        wants_direct_prompt
        or _infer_prompt_kind(request) == "follow_up"
        or any(marker in _norm(" ".join(request.constraints)) for marker in ("concise", "short", "light", "do not expand", "don't expand"))
    )

    if wants_light_touch:
        source = " ".join((request.source_prompt or "").split()).strip()
        if not source:
            return ""

        source = source[0].upper() + source[1:] if source else source
        source = source.rstrip()
        if source and source[-1] not in ".!?":
            source += "."

        lines: List[str] = []
        if request.conversation_context or request.project_context:
            lines.append("Use the current conversation context.")
        lines.append(source)

        constraint_text = _norm(" ".join(request.constraints))
        if "concise" not in constraint_text and "short" not in constraint_text:
            lines.append("Keep it concise and user-friendly.")
        if "context" not in constraint_text and (request.conversation_context or request.project_context):
            lines.append("Make sure it fits the existing context.")

        return " ".join(lines)

    sections: List[str] = []

    if request.goal:
        sections.append(f"Goal:\n{request.goal}")
    if request.audience:
        sections.append(f"Audience:\n{request.audience}")
    if request.project_context:
        sections.append(f"Project Context:\n{request.project_context}")

    conversation_context = _context_items_payload(request.conversation_context)
    if conversation_context:
        conversation_lines = []
        for item in conversation_context[-4:]:
            role = (item.get("role") or item.get("title") or "context").title()
            conversation_lines.append(f"- {role}: {item['content']}")
        sections.append("Relevant Conversation Context:\n" + "\n".join(conversation_lines))

    extra_context = _context_items_payload(request.extra_context)
    if extra_context:
        context_lines = []
        for item in extra_context[:4]:
            heading = item.get("title") or "Context"
            context_lines.append(f"- {heading}: {item['content']}")
        sections.append("Additional Context:\n" + "\n".join(context_lines))

    sections.append(f"Task:\n{request.source_prompt.strip()}")

    output_lines = []
    if request.output_format:
        output_lines.append(f"Use this format: {request.output_format}")
    if request.tone:
        output_lines.append(f"Match this tone: {request.tone}")
    if request.target_models:
        output_lines.append("Keep wording compatible with: " + ", ".join(request.target_models[:6]))
    output_lines.append("Be precise, explicit, and avoid inventing facts.")
    if request.constraints:
        output_lines.extend(request.constraints[:8])
    sections.append("Output Requirements:\n" + "\n".join(f"- {line}" for line in output_lines))

    return "\n\n".join(section for section in sections if section.strip())


def _infer_prompt_kind(request: OptimizePromptRequest) -> str:
    if request.prompt_kind in {"initial", "follow_up"}:
        return request.prompt_kind

    text = _norm(request.source_prompt)
    follow_up_markers = (
        "same", "this", "that", "above", "earlier", "follow up", "followup",
        "continue", "also", "instead", "make it", "change it", "shorter",
        "longer", "better", "rewrite", "improve", "more concise", "more detailed",
    )
    if any(marker in text for marker in follow_up_markers):
        return "follow_up"
    if request.conversation_context:
        return "follow_up"
    return "initial"


def _fallback_prompt_evaluation(request: EvaluatePromptRequest) -> EvaluatePromptResponse:
    prompt_text = (request.prompt or "").strip()
    lower_prompt = prompt_text.lower()
    dimension_scores = {
        "clarity": 65 if len(prompt_text) >= 40 else 45,
        "context": 75 if request.project_context or request.extra_context else 40,
        "specificity": 72 if any(token in lower_prompt for token in ("must", "should", "include", "avoid")) else 48,
        "constraints": 70 if any(token in lower_prompt for token in ("do not", "avoid", "limit", "exactly")) else 42,
        "output_guidance": 76 if any(token in lower_prompt for token in ("format", "json", "table", "bullet")) else 44,
    }
    overall_score = int(round(sum(dimension_scores.values()) / len(dimension_scores)))

    strengths = []
    if dimension_scores["context"] >= 70:
        strengths.append("Includes useful supporting context.")
    if dimension_scores["output_guidance"] >= 70:
        strengths.append("Gives the model concrete output expectations.")
    if not strengths:
        strengths.append("Captures a recognizable user intent.")

    weaknesses = []
    if dimension_scores["context"] < 60:
        weaknesses.append("Missing project or background context.")
    if dimension_scores["constraints"] < 60:
        weaknesses.append("Does not clearly state constraints or failure boundaries.")
    if dimension_scores["specificity"] < 60:
        weaknesses.append("Task instructions are still broad or underspecified.")

    recommendations = [
        "State the goal, audience, and definition of success explicitly.",
        "Add concrete constraints, edge cases, and things the model must avoid.",
        "Specify the exact output structure you want back.",
    ]

    rewritten_excerpt = None
    if prompt_text:
        rewritten_excerpt = _fallback_optimized_prompt(
            OptimizePromptRequest(
                source_prompt=prompt_text,
                project_context=request.project_context,
                extra_context=request.extra_context,
                goal=request.intended_outcome,
                target_models=request.target_models,
            )
        )

    return EvaluatePromptResponse(
        request_id=f"req_{uuid4().hex[:12]}",
        overall_score=overall_score,
        dimension_scores=dimension_scores,
        strengths=strengths,
        weaknesses=weaknesses,
        recommendations=recommendations,
        rewritten_excerpt=rewritten_excerpt,
    )


async def run_llm(
    profile_data: Dict[str, Any],
    normalized_context: Dict[str, Any],
    llm_fields: List[Dict[str, Any]],
    retrieval_context: Dict[str, Dict[str, Any]],
) -> Tuple[List[FieldSuggestion], float]:
    if not llm_fields:
        return [], 0.0

    user_message = build_user_message(profile_data, normalized_context, llm_fields, retrieval_context)
    data, cost = await _run_json_llm(
        user_message,
        SYSTEM_PROMPT,
        log_label="Field analysis LLM call",
        temperature=0.0,
    )
    if not data:
        return [], 0.0

    suggestions = []
    for raw in data.get("suggestions", []):
        try:
            suggestions.append(FieldSuggestion(**raw))
        except Exception as exc:
            _trace(f"Invalid LLM suggestion skipped: {exc} | payload={raw}", "WARNING")
    _trace(f"LLM returned {len(suggestions)} suggestion(s). Cost=${cost:.6f}")
    return suggestions, cost


async def optimize_prompt_request(request: OptimizePromptRequest) -> OptimizePromptResponse:
    started = time.time()
    request_id = f"req_{uuid4().hex[:12]}"
    prompt_kind = _infer_prompt_kind(request)
    payload = {
        "source_prompt": request.source_prompt,
        "project_context": request.project_context,
        "conversation_context": _context_items_payload(request.conversation_context),
        "extra_context": _context_items_payload(request.extra_context),
        "goal": request.goal,
        "audience": request.audience,
        "tone": request.tone,
        "output_format": request.output_format,
        "constraints": request.constraints,
        "target_models": request.target_models,
        "preserve_intent": request.preserve_intent,
        "explanation_style": request.explanation_style,
        "prompt_kind": prompt_kind,
    }
    data, cost = await _run_json_llm(
        build_optimize_prompt_message(payload),
        PROMPT_OPTIMIZER_SYSTEM_PROMPT,
        log_label="Prompt optimizer",
        temperature=0.2,
    )

    optimized_prompt = (data or {}).get("optimized_prompt") or _fallback_optimized_prompt(request)
    title = (data or {}).get("title") or "Optimized Prompt"
    summary = (data or {}).get("summary") or "Restructured for clearer instructions and stronger output guidance."
    explanation = (data or {}).get("explanation")
    if not explanation:
        explanation = (
            "Resolved the follow-up using recent context and made the request explicit."
            if prompt_kind == "follow_up"
            else "Clarified the request and made the instructions easier to follow."
        )
    improvements = _normalize_text_list((data or {}).get("improvements")) or [
        "Adds clearer task framing and response guidance.",
        "Organizes context and constraints so the model has less room to guess.",
    ]
    warnings = _normalize_text_list((data or {}).get("warnings"))
    if not data:
        warnings = warnings or ["LLM optimizer unavailable; returned a local fallback structure."]

    target_models = _normalize_text_list((data or {}).get("target_models"), max_items=8) or list(request.target_models[:8])

    return OptimizePromptResponse(
        request_id=request_id,
        optimized_prompt=str(optimized_prompt).strip(),
        title=title,
        summary=summary,
        explanation=str(explanation).strip(),
        prompt_kind=(data or {}).get("prompt_kind") or prompt_kind,
        improvements=improvements,
        warnings=warnings,
        target_models=target_models,
        latency_sec=round(time.time() - started, 2),
        cost_usd=round(cost, 6),
    )


async def evaluate_prompt_request(request: EvaluatePromptRequest) -> EvaluatePromptResponse:
    started = time.time()
    payload = {
        "prompt": request.prompt,
        "project_context": request.project_context,
        "extra_context": _context_items_payload(request.extra_context),
        "intended_outcome": request.intended_outcome,
        "rubric": request.rubric,
        "target_models": request.target_models,
    }
    data, cost = await _run_json_llm(
        build_evaluate_prompt_message(payload),
        PROMPT_EVALUATOR_SYSTEM_PROMPT,
        log_label="Prompt evaluator",
        temperature=0.1,
    )

    if not data:
        fallback = _fallback_prompt_evaluation(request)
        fallback.latency_sec = round(time.time() - started, 2)
        fallback.cost_usd = 0.0
        return fallback

    overall_score = int((data.get("overall_score") or 0))
    dimension_scores_raw = data.get("dimension_scores") or {}
    dimension_scores = {
        str(key): max(0, min(100, int(value)))
        for key, value in dimension_scores_raw.items()
        if str(key).strip()
    }
    if not dimension_scores:
        dimension_scores = {
            "clarity": overall_score,
            "context": overall_score,
            "specificity": overall_score,
            "constraints": overall_score,
            "output_guidance": overall_score,
        }

    return EvaluatePromptResponse(
        request_id=f"req_{uuid4().hex[:12]}",
        overall_score=max(0, min(100, overall_score)),
        dimension_scores=dimension_scores,
        strengths=_normalize_text_list(data.get("strengths")),
        weaknesses=_normalize_text_list(data.get("weaknesses")),
        recommendations=_normalize_text_list(data.get("recommendations")),
        rewritten_excerpt=(str(data.get("rewritten_excerpt")).strip() if data.get("rewritten_excerpt") else None),
        latency_sec=round(time.time() - started, 2),
        cost_usd=round(cost, 6),
    )


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

    if _is_option_field(field) and raw.suggested_value not in (None, ""):
        option_match = _match_option_value(field, raw.suggested_value)
        if not option_match or not option_match.get("resolved_value"):
            alternatives = [
                item.get("text") or item.get("value")
                for item in _valid_options(field)[:3]
                if item.get("text") or item.get("value")
            ]
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
        raw.suggested_value = option_match["resolved_value"]
        confidence = min(99, int(round((confidence * 0.4) + (option_match["confidence"] * 0.6))))

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
    merged_profile = _deep_merge_profiles(get_user_data(), normalized_context["profile"].get("data") or {})
    normalized_context["profile"]["merged_data"] = merged_profile
    normalized_context["profile"]["merged_flat_data"] = flatten_profile_data(merged_profile)
    profile_data = merged_profile
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
        if direct and direct.status != "failed":
            suggestions.append(direct)
            debug_entry["decision_path"].append("domain_mapping")
            debug_fields.append(debug_entry)
            continue

        direct = resolve_learned_value(field, normalized_context)
        if direct and direct.status != "failed":
            suggestions.append(direct)
            debug_entry["decision_path"].append("learned_cache")
            debug_fields.append(debug_entry)
            continue

        direct = resolve_dropdown_from_profile_pool(field, normalized_context)
        if direct and direct.status == "matched":
            suggestions.append(direct)
            debug_entry["decision_path"].append("dropdown_profile_pool")
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
