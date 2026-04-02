import json

# STATIC system prompt — never changes, never contains documents or user data.
# This is cached by Gemini and costs nearly nothing to repeat.
SYSTEM_PROMPT = """You are a form-filling AI minimizing token usage. 
Map fields to the best profile value. 
Rules:
1. Provide extremely concise, single-sentence answers. DO NOT write paragraphs.
2. For sensitive fields (SSN, credit card, passwords) return null.
3. For select/dropdowns, return the exact option value.

Respond EXCLUSIVELY with this JSON:
{"mappings":[{"field_id":"<id>","value":"<short value or null>"}]}"""


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
    # 1. Strip empty values & aggressively format lengths to prevent token exhaustion
    clean_profile = {}
    for k, v in user_data.items():
        if v in (None, "", [], {}):
            continue
        if isinstance(v, list):
            # Cap array items to prevent token-heavy massive skill lists
            clean_profile[k] = ", ".join([str(i) for i in v[:15]])
        elif isinstance(v, str):
            # Cap string properties to ~150 chars max
            clean_profile[k] = v[:150]
        else:
            clean_profile[k] = v

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
    else:
        # Provide fallback natural language to stabilize Gemini preview models.
        # Preview models frequently throw 503 UNAVAILABLE if the input contains ONLY
        # dense JSON dictionaries without human-readable conversational context.
        parts["resume_context"] = "No additional resume document provided. Please rely exclusively on the profile data above."

    return json.dumps(parts, separators=(',', ':'))  # compact JSON = fewer tokens
