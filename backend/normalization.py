from __future__ import annotations

import re
from typing import Any, Dict, List
from urllib.parse import urlparse

from .contracts import AnalyzeFieldsRequest, DetectedField

NOISY_TOKEN_RE = re.compile(r"\b(?:ff_)?field_\d+\b|\bfld_\d+\b|\binput_\d+\b", re.I)
SPACE_RE = re.compile(r"\s+")

INTENT_PATTERNS = [
    ("full_name", [r"full.?name", r"applicant.?name", r"candidate.?name"]),
    ("first_name", [r"first.?name", r"given.?name", r"forename"]),
    ("last_name", [r"last.?name", r"surname", r"family.?name"]),
    ("email", [r"\bemail\b", r"e.?mail"]),
    ("phone", [r"\bphone\b", r"mobile", r"telephone", r"\btel\b"]),
    ("address", [r"street", r"address", r"mailing"]),
    ("city", [r"\bcity\b", r"town", r"municipality"]),
    ("state", [r"\bstate\b", r"province", r"region"]),
    ("zip", [r"zip", r"postal", r"postcode", r"pincode"]),
    ("country", [r"\bcountry\b", r"nationality"]),
    ("current_company", [r"company", r"employer", r"organization"]),
    ("current_title", [r"job.?title", r"position", r"designation", r"\brole\b"]),
    ("linkedin", [r"linkedin"]),
    ("github", [r"github"]),
    ("portfolio", [r"portfolio"]),
    ("website", [r"website", r"homepage", r"\burl\b"]),
    ("education_level", [r"degree", r"education", r"qualification"]),
    ("experience_years", [r"years?.?of.?exp", r"\byoe\b", r"experience"]),
    ("work_authorization", [r"authorized?.?to.?work", r"work.?author", r"right.?to.?work"]),
    ("sponsorship", [r"sponsor", r"h-?1b", r"visa"]),
    ("salary_expectation", [r"salary", r"compensation", r"ctc", r"expected.?pay"]),
    ("summary", [r"summary", r"about", r"cover.?letter", r"why.?join"]),
    ("skills", [r"skills", r"expertise", r"competenc"]),
    ("gender", [r"gender", r"pronouns"]),
    ("dob", [r"date.?of.?birth", r"\bdob\b", r"birth"]),
]

PROFILE_ALIASES = {
    "full_name": ["full_name", "name"],
    "first_name": ["first_name"],
    "last_name": ["last_name"],
    "email": ["email"],
    "phone": ["phone"],
    "address": ["address"],
    "city": ["city"],
    "state": ["state"],
    "zip": ["zip", "postal_code"],
    "country": ["country"],
    "current_company": ["current_company", "company"],
    "current_title": ["current_title", "job_title", "title"],
    "linkedin": ["linkedin"],
    "github": ["github"],
    "portfolio": ["portfolio"],
    "website": ["website"],
    "education_level": ["highest_degree"],
    "experience_years": ["years_of_experience"],
    "summary": ["summary"],
    "skills": ["skills"],
    "gender": ["gender"],
    "dob": ["dob"],
}


def clean_text(value: Any, max_len: int = 260) -> str | None:
    if value is None:
        return None
    text = SPACE_RE.sub(" ", str(value)).strip()
    if not text:
        return None
    return text[:max_len]


def clean_signal(value: Any, max_len: int = 260) -> str | None:
    text = clean_text(value, max_len=max_len)
    if not text:
        return None
    if NOISY_TOKEN_RE.fullmatch(text.lower()):
        return None
    return text


def normalize_option(option: Any) -> Dict[str, Any] | None:
    if not option:
        return None
    text = clean_text(getattr(option, "text", None) if not isinstance(option, dict) else option.get("text"))
    value = clean_text(getattr(option, "value", None) if not isinstance(option, dict) else option.get("value"))
    if not text and not value:
        return None
    return {
        "text": text,
        "value": value,
        "selected": bool(getattr(option, "selected", False) if not isinstance(option, dict) else option.get("selected")),
        "checked": bool(getattr(option, "checked", False) if not isinstance(option, dict) else option.get("checked")),
    }


def infer_intent(field: DetectedField) -> str:
    if field.normalized_intent and field.normalized_intent != "unknown":
        return field.normalized_intent

    text = " ".join(
        filter(
            None,
            [
                clean_signal(field.label),
                clean_signal(field.placeholder),
                clean_signal(field.aria_label),
                clean_signal(field.field_name),
                clean_signal(field.nearby_text),
                clean_signal(field.section_heading),
            ],
        )
    ).lower()

    if not text:
        return "unknown"

    for intent, patterns in INTENT_PATTERNS:
        for pattern in patterns:
            if re.search(pattern, text, re.I):
                return intent
    return "unknown"


def flatten_profile_data(profile_data: Dict[str, Any]) -> Dict[str, Any]:
    flat: Dict[str, Any] = {}
    for key, value in (profile_data or {}).items():
        if value in (None, "", [], {}):
            continue
        if isinstance(value, dict):
            nested = flatten_profile_data(value)
            for nested_key, nested_value in nested.items():
                flat[f"{key}.{nested_key}"] = nested_value
        else:
            flat[key] = value
    return flat


def build_field_query(field: Dict[str, Any], page: Dict[str, Any], form: Dict[str, Any]) -> str:
    parts: List[str] = []

    if field["intent"] != "unknown":
        parts.append(f"intent {field['intent']}")
    if field.get("label"):
        parts.append(f"label {field['label']}")
    if field.get("placeholder"):
        parts.append(f"placeholder {field['placeholder']}")
    if field.get("aria_label"):
        parts.append(f"aria {field['aria_label']}")
    if field.get("section_heading"):
        parts.append(f"section {field['section_heading']}")
    if field.get("nearby_text"):
        parts.append(f"context {field['nearby_text']}")
    if field.get("parent_section_text"):
        parts.append(f"group {field['parent_section_text']}")
    if form.get("form_type"):
        parts.append(f"form {form['form_type']}")
    if page.get("page_type") and page.get("page_type") != form.get("form_type"):
        parts.append(f"page {page['page_type']}")
    if page.get("domain"):
        parts.append(f"domain {page['domain']}")

    options = field.get("candidate_options") or []
    option_labels = [opt.get("text") or opt.get("value") for opt in options if opt.get("text") or opt.get("value")]
    if option_labels:
        parts.append("options " + ", ".join(option_labels[:8]))

    return ". ".join(parts)


def normalize_request(request: AnalyzeFieldsRequest) -> Dict[str, Any]:
    page = {
        "domain": clean_text(request.page.domain, 120),
        "page_url": clean_text(request.page.page_url, 240),
        "page_title": clean_text(request.page.page_title, 180),
        "page_type": clean_text(request.page.page_type, 80),
    }
    if not page["domain"] and page["page_url"]:
        try:
            parsed = urlparse(page["page_url"])
            page["domain"] = clean_text(parsed.hostname, 120)
        except Exception:
            page["domain"] = None
    form = {
        "form_id": clean_text(request.form.form_id, 120),
        "form_name": clean_text(request.form.form_name, 120),
        "form_action": clean_text(request.form.form_action, 200),
        "form_method": clean_text(request.form.form_method, 20),
        "form_type": clean_text(request.form.form_type, 80),
        "section_heading": clean_text(request.form.section_heading, 120),
        "detected_field_count": request.form.detected_field_count,
    }

    normalized_fields = []
    for field in request.detected_fields:
        options = [opt for opt in (normalize_option(option) for option in field.candidate_options) if opt]
        normalized = {
            "field_id": field.field_id,
            "field_name": clean_signal(field.field_name, 120),
            "label": clean_signal(field.label, 140),
            "placeholder": clean_signal(field.placeholder, 140),
            "aria_label": clean_signal(field.aria_label, 140),
            "field_type": clean_text(field.field_type, 60),
            "input_tag": clean_text(field.input_tag, 40),
            "current_value": field.current_value,
            "candidate_options": options,
            "nearby_text": clean_signal(field.nearby_text, 180),
            "parent_section_text": clean_signal(field.parent_section_text, 260),
            "section_heading": clean_signal(field.section_heading, 120),
            "autocomplete": clean_text(field.autocomplete, 60),
            "required": field.required,
            "visible": field.visible,
            "disabled": field.disabled,
            "css_selector": clean_text(field.css_selector, 200),
            "form_id": clean_text(field.form_id, 120),
            "form_name": clean_text(field.form_name, 120),
        }
        normalized["intent"] = infer_intent(field)
        normalized["query"] = build_field_query(normalized, page, form)
        normalized_fields.append(normalized)

    target_ids = set(request.target_field_ids or [field["field_id"] for field in normalized_fields])
    target_fields = [field for field in normalized_fields if field["field_id"] in target_ids]
    flat_profile = flatten_profile_data(request.profile.data)

    return {
        "page": page,
        "form": form,
        "fields": normalized_fields,
        "target_fields": target_fields,
        "profile": {
            "profile_id": request.profile.profile_id,
            "profile_name": request.profile.profile_name,
            "data": request.profile.data,
            "flat_data": flat_profile,
        },
        "learned": {
            "domain_mappings": request.learned.domain_mappings,
            "entries": [entry.model_dump() for entry in request.learned.entries],
        },
        "user_action": request.user_action.model_dump(),
    }


def profile_value_for_intent(profile_data: Dict[str, Any], intent: str) -> Any:
    if not intent or intent == "unknown":
        return None
    aliases = PROFILE_ALIASES.get(intent, [])
    for key in aliases:
        if key in profile_data and profile_data[key] not in (None, "", [], {}):
            return profile_data[key]
    return None
