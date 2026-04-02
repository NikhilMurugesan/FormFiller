import json

# STATIC system prompt — never changes, never contains documents or user data.
# This is cached by Gemini and costs nearly nothing to repeat.
SYSTEM_PROMPT = """You are a form-filling agent. You receive a compact user profile and a list of HTML form fields. 
Map each field to the best matching value. If no exact match exists, generate a plausible professional answer from context.
For sensitive fields (SSN, credit card, passwords) return null.
For select/dropdown fields, return the option value that best fits the user's profile.

Respond ONLY with this JSON — no markdown, no explanation:
{"mappings":[{"field_id":"<id>","value":"<value or null>"}]}`"""


def build_compact_user_message(user_data: dict, fields: list, doc_chunks: list) -> str:
    """
    Build a minimal, token-efficient user message.

    Optimizations:
    1. Strip None / empty values from user_data before serializing
    2. Compress skills list to a single comma-separated string
    3. Document chunks injected here (NOT in system prompt) so they're
       only part of the USER turn — no repeated overhead
    4. Field metadata stripped down (remove null keys)
    """
    # 1. Strip empty values
    clean_profile = {k: v for k, v in user_data.items() if v not in (None, "", [], {})}

    # 2. Compress skills if it's a list
    if isinstance(clean_profile.get("skills"), list):
        clean_profile["skills"] = ", ".join(clean_profile["skills"])

    # 3. Compress fields — remove keys whose value is None
    compact_fields = []
    for f in fields:
        cf = {k: v for k, v in f.items() if v is not None}
        compact_fields.append(cf)

    # 4. Build message — doc context goes here, not in system prompt
    parts = {
        "profile": clean_profile,
        "fields": compact_fields
    }
    if doc_chunks:
        # Trim each chunk and cap total doc context characters to keep tokens low
        trimmed = [c[:400] for c in doc_chunks[:3]]
        parts["resume_context"] = " | ".join(trimmed)

    return json.dumps(parts, separators=(',', ':'))  # compact JSON = fewer tokens
