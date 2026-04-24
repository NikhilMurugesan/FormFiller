import json
import re
from typing import Any, Dict, List


SYSTEM_PROMPT = """You are the fallback mapper for a browser form autofill system.
The extension already tried deterministic local matching first. Your job is to map only the remaining fields to values that are explicitly present in the provided data.

Use the field label, placeholder, nearby text, section heading, options, page/form context, learned hints, profile QA answers, profile/autofill/form preference data, and resume snippets.
Rules:
1. Never invent facts absent from profile, learned hints, profile QA, form preferences, or resume context.
2. Skip sensitive fields such as passwords, SSN, credit card, OTP, CVV.
3. For select/radio/checkbox fields, suggested_value must exactly match one option text or option value.
4. Prefer exact learned hints and profile QA when the field label/question matches the current field.
5. Prefer profile/autofill/form preference values over resume snippets for ordinary identity, contact, job preference, education, and yes/no fields.
6. You may combine profile values only when all components are present, such as first_name + last_name for full_name.
7. Treat low-confidence learned hints as context, not as automatic truth.
8. If a field asks for a yes/no answer, use an explicit learned/profile/profile-QA answer; do not infer from unrelated text.
9. For fields with answer_mode "profile_grounded_answer", read the full question and write a direct, paste-ready answer using only the provided profile, QA, learned hints, form preferences, and resume context. Synthesis is allowed when it combines provided facts; fabrication is not.
10. Open-ended answer fields should usually be first person, concise, and specific. Use 2-5 sentences unless the question asks for a number, a short answer, or a different format.
11. If the available data is insufficient for an open-ended answer, return status "uncertain" with the best grounded answer, or "failed" with null when there is no grounded answer.
12. status must be one of matched, uncertain, failed, skipped.
13. confidence is 0-100.
14. source must be one of rag, learned, profile, deterministic, failed.

Respond only as JSON:
{"suggestions":[{"field_id":"...","detected_intent":"...","suggested_value":"...","source":"rag","confidence":84,"reason":"short reason","status":"matched","candidate_alternatives":["..."]}]}"""


PROMPT_OPTIMIZER_SYSTEM_PROMPT = """You are a prompt optimizer for AI assistants.
Transform rough user ideas into strong, model-agnostic prompts.
Preserve the user's intent. Improve clarity, structure, context, constraints, and output instructions without adding fake facts.

Important rules:
1. Use project context, conversation context, and extra context when they help resolve ambiguous follow-up prompts.
2. If the source prompt looks like a follow-up, rewrite it so it stands on its own while preserving the requested change.
3. Do not over-explain. explanation must be short, practical, and to the point.
4. Make the prompt more user friendly. Prefer clear steps, explicit outcomes, and direct wording.
5. Default to light-touch optimization. Keep the rewritten prompt close to the user's original length and intent unless the user explicitly asks for a full prompt template.
6. For normal chat follow-ups, optimized_prompt should usually be a direct improved prompt, not a multi-section framework.
7. Do not include labels like "Project Context", "Task", or "Output Requirements" inside optimized_prompt unless the user explicitly asks for that structure.

Respond only as JSON:
{"title":"short title","summary":"one sentence","explanation":"short rationale","prompt_kind":"initial|follow_up","optimized_prompt":"full optimized prompt","improvements":["..."],"warnings":["..."],"target_models":["..."]}"""


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


def _trim_profile_value(value: Any) -> Any:
    if isinstance(value, str):
        return value[:700]
    if isinstance(value, list):
        return [_trim_profile_value(item) for item in value[:8]]
    if isinstance(value, dict):
        return {key: _trim_profile_value(item) for key, item in list(value.items())[:60]}
    return value


WORD_RE = re.compile(r"[a-z0-9]+")


def _norm(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _token_overlap(left: Any, right: Any) -> float:
    left_tokens = set(WORD_RE.findall(_norm(left)))
    right_tokens = set(WORD_RE.findall(_norm(right)))
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / max(len(left_tokens), len(right_tokens))


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


def _profile_for_prompt(profile_data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: _trim_profile_value(value)
        for key, value in (profile_data or {}).items()
        if key != "learned_memory"
    }


def _learned_hints_for_field(field: Dict[str, Any], normalized_context: Dict[str, Any]) -> List[Dict[str, Any]]:
    domain = normalized_context.get("page", {}).get("domain")
    entries = normalized_context.get("learned", {}).get("entries") or []
    field_text = _field_text(field)
    field_text_norm = _norm(field_text)
    field_id_norm = _norm(field.get("field_id"))
    field_name_norm = _norm(field.get("field_name"))
    intent = field.get("intent")
    ranked = []

    for entry in entries:
        value = entry.get("value") if isinstance(entry, dict) else None
        if value in (None, "", [], {}):
            continue

        entry_domain = entry.get("domain")
        same_domain = entry_domain in {domain, None}
        global_domain = entry_domain == "__global__"
        entry_intent = entry.get("field_intent")
        label_norm = _norm(entry.get("field_label"))
        score = 0

        if same_domain and field_id_norm and _norm(entry.get("field_id")) == field_id_norm:
            score += 60
        if same_domain and field_name_norm and _norm(entry.get("field_name")) == field_name_norm:
            score += 45
        if intent and intent != "unknown" and entry_intent == intent:
            score += 32 if same_domain else 18 if global_domain else 0
        if label_norm and field_text_norm:
            if label_norm == _norm(field.get("label")):
                score += 34
            elif label_norm in field_text_norm:
                score += 24
            else:
                score += int(_token_overlap(label_norm, field_text_norm) * 28)
        if same_domain:
            score += 12
        elif global_domain:
            score += 5
        score += min(int(entry.get("confidence") or 0), 100) // 10

        if score >= 30:
            ranked.append(
                {
                    "score": score,
                    "domain": entry_domain,
                    "field_label": entry.get("field_label"),
                    "field_intent": entry_intent,
                    "value": value,
                    "confidence": entry.get("confidence"),
                    "source": entry.get("value_source"),
                }
            )

    ranked.sort(key=lambda item: item["score"], reverse=True)
    return [_trim_value(item, 180) for item in ranked[:4]]


def _profile_qa_hints_for_field(profile_data: Dict[str, Any], field: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_sections = [
        profile_data.get("qa"),
        profile_data.get("form_qa"),
        profile_data.get("common_form_answers"),
    ]
    learned_memory = profile_data.get("learned_memory") or {}
    if isinstance(learned_memory, dict):
        raw_sections.append(learned_memory.get("qa"))

    field_text = _field_text(field)
    field_text_norm = _norm(field_text)
    hints = []
    for raw_section in raw_sections:
        if isinstance(raw_section, dict):
            raw_items = [{"question": question, "answer": answer} for question, answer in raw_section.items()]
        elif isinstance(raw_section, list):
            raw_items = raw_section
        else:
            continue

        for item in raw_items:
            if not isinstance(item, dict):
                continue
            question = item.get("question") or item.get("label") or item.get("field_label")
            answer = item.get("answer", item.get("value"))
            if not question or answer in (None, "", [], {}):
                continue
            question_norm = _norm(question)
            overlap = _token_overlap(question_norm, field_text_norm)
            if question_norm in field_text_norm or overlap >= 0.65:
                hints.append(
                    {
                        "question": question,
                        "answer": answer,
                        "confidence": item.get("confidence"),
                        "source": item.get("source") or "profile_qa",
                    }
                )
    return [_trim_value(item, 180) for item in hints[:4]]


def build_user_message(
    profile_data: Dict[str, Any],
    normalized_context: Dict[str, Any],
    llm_fields: List[Dict[str, Any]],
    retrieval_context: Dict[str, Dict[str, Any]],
) -> str:
    payload = {
        "page": normalized_context["page"],
        "form": normalized_context["form"],
        "profile": _profile_for_prompt(profile_data),
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
                "answer_mode": field.get("answer_mode"),
                "query": field.get("query"),
                "nearby_text": field.get("nearby_text"),
                "section_heading": field.get("section_heading"),
                "parent_section_text": field.get("parent_section_text"),
                "candidate_options": field.get("candidate_options", [])[:8],
                "learned_hints": _learned_hints_for_field(field, normalized_context),
                "profile_qa_hints": _profile_qa_hints_for_field(profile_data, field),
                "resume_context": retrieval.get("context_text"),
            }
        )

    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def build_optimize_prompt_message(payload: Dict[str, Any]) -> str:
    return json.dumps(
        {
            "source_prompt": _trim_value(payload.get("source_prompt"), 4000),
            "project_context": _trim_value(payload.get("project_context"), 2000),
            "conversation_context": _trim_value(payload.get("conversation_context"), 2400),
            "extra_context": _trim_value(payload.get("extra_context"), 2000),
            "goal": _trim_value(payload.get("goal"), 400),
            "audience": _trim_value(payload.get("audience"), 300),
            "tone": _trim_value(payload.get("tone"), 200),
            "output_format": _trim_value(payload.get("output_format"), 300),
            "constraints": _trim_value(payload.get("constraints"), 400),
            "target_models": _trim_value(payload.get("target_models"), 200),
            "preserve_intent": bool(payload.get("preserve_intent", True)),
            "explanation_style": _trim_value(payload.get("explanation_style"), 80),
            "prompt_kind": _trim_value(payload.get("prompt_kind"), 80),
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
