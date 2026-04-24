from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _clean_str(value: Any) -> Optional[str]:
    if value is None:
      return None
    if not isinstance(value, str):
      return value
    cleaned = " ".join(value.split()).strip()
    return cleaned or None


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    @field_validator("*", mode="before")
    @classmethod
    def blank_strings_to_none(cls, value: Any) -> Any:
        if isinstance(value, str):
            return _clean_str(value)
        return value


class CandidateOption(ContractModel):
    value: Optional[str] = None
    text: Optional[str] = None
    checked: Optional[bool] = None
    selected: Optional[bool] = None
    disabled: Optional[bool] = None


class PageMetadata(ContractModel):
    domain: Optional[str] = None
    page_url: Optional[str] = None
    page_title: Optional[str] = None
    page_type: Optional[str] = None


class FormMetadata(ContractModel):
    form_id: Optional[str] = None
    form_name: Optional[str] = None
    form_action: Optional[str] = None
    form_method: Optional[str] = None
    form_type: Optional[str] = None
    section_heading: Optional[str] = None
    detected_field_count: int = 0


class ProfileContext(ContractModel):
    profile_id: Optional[str] = None
    profile_name: Optional[str] = None
    data: Dict[str, Any] = Field(default_factory=dict)


class UserActionContext(ContractModel):
    action: Optional[str] = None
    triggered_by: Optional[str] = None
    only_empty: bool = False


class LearnedEntry(ContractModel):
    id: Optional[str] = None
    domain: Optional[str] = None
    page_type: Optional[str] = None
    field_label: Optional[str] = None
    field_type: Optional[str] = None
    field_name: Optional[str] = None
    field_id: Optional[str] = None
    placeholder: Optional[str] = None
    field_intent: Optional[str] = None
    value: Any = None
    confidence: int = 0
    value_source: Optional[str] = None
    usage_count: int = 0
    correction_count: int = 0
    created_at: Optional[str] = None
    last_used_at: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def accept_extension_export_keys(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        key_map = {
            "pageType": "page_type",
            "fieldLabel": "field_label",
            "fieldType": "field_type",
            "fieldName": "field_name",
            "fieldId": "field_id",
            "fieldIntent": "field_intent",
            "valueSource": "value_source",
            "usageCount": "usage_count",
            "correctionCount": "correction_count",
            "createdAt": "created_at",
            "lastUsedAt": "last_used_at",
        }
        upgraded = dict(value)
        for source, target in key_map.items():
            if source in upgraded and target not in upgraded:
                upgraded[target] = upgraded[source]
        return upgraded


class LearnedContext(ContractModel):
    domain_mappings: Dict[str, str] = Field(default_factory=dict)
    entries: List[LearnedEntry] = Field(default_factory=list)


class DetectedField(ContractModel):
    field_id: str
    field_name: Optional[str] = None
    label: Optional[str] = None
    placeholder: Optional[str] = None
    aria_label: Optional[str] = None
    field_type: Optional[str] = None
    input_tag: Optional[str] = None
    current_value: Any = None
    candidate_options: List[CandidateOption] = Field(default_factory=list)
    nearby_text: Optional[str] = None
    parent_section_text: Optional[str] = None
    section_heading: Optional[str] = None
    autocomplete: Optional[str] = None
    required: bool = False
    visible: bool = True
    disabled: bool = False
    css_selector: Optional[str] = None
    normalized_intent: Optional[str] = None
    form_id: Optional[str] = None
    form_name: Optional[str] = None
    form_action: Optional[str] = None
    form_method: Optional[str] = None
    form_index: Optional[int] = None


class AnalyzeFieldsRequest(ContractModel):
    contract_version: str = "2026-04-08"
    session_id: str = "default"
    debug: bool = False
    page: PageMetadata = Field(default_factory=PageMetadata)
    form: FormMetadata = Field(default_factory=FormMetadata)
    profile: ProfileContext = Field(default_factory=ProfileContext)
    learned: LearnedContext = Field(default_factory=LearnedContext)
    user_action: UserActionContext = Field(default_factory=UserActionContext)
    target_field_ids: List[str] = Field(default_factory=list)
    detected_fields: List[DetectedField] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy_payload(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        if "detected_fields" in value or "profile" in value:
            return value

        legacy_fields = value.get("fields") or []
        upgraded_fields = []
        for field in legacy_fields:
            if not isinstance(field, dict):
                continue
            upgraded_fields.append({
                "field_id": field.get("id") or field.get("field_id"),
                "field_name": field.get("name"),
                "label": field.get("label"),
                "placeholder": field.get("placeholder"),
                "field_type": field.get("type"),
            })

        return {
            "contract_version": value.get("contract_version", "legacy"),
            "session_id": value.get("session_id", "default"),
            "debug": value.get("debug", False),
            "profile": {"data": value.get("user_data") or {}},
            "detected_fields": upgraded_fields,
            "target_field_ids": [field["field_id"] for field in upgraded_fields if field.get("field_id")],
        }

    @model_validator(mode="after")
    def default_targets(self) -> "AnalyzeFieldsRequest":
        if not self.target_field_ids:
            self.target_field_ids = [field.field_id for field in self.detected_fields]
        return self


class FieldSuggestion(ContractModel):
    field_id: str
    label: Optional[str] = None
    detected_intent: Optional[str] = None
    suggested_value: Any = None
    source: str = "failed"
    confidence: int = 0
    reason: str = ""
    status: str = "failed"
    candidate_alternatives: List[str] = Field(default_factory=list)


class AnalyzeFieldsResponse(ContractModel):
    contract_version: str = "2026-04-08"
    request_id: str
    suggestions: List[FieldSuggestion] = Field(default_factory=list)
    latency_sec: float = 0.0
    cost_usd: float = 0.0
    debug: Optional[Dict[str, Any]] = None


class PromptContextItem(ContractModel):
    context_id: Optional[str] = None
    role: Optional[str] = None
    title: Optional[str] = None
    content: str = ""
    tags: List[str] = Field(default_factory=list)


class SavedPrompt(ContractModel):
    prompt_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    prompt_text: str = ""
    project_context: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    target_models: List[str] = Field(default_factory=list)
    source: Optional[str] = None
    favorite: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class OptimizePromptRequest(ContractModel):
    contract_version: str = "2026-04-08"
    source_prompt: str
    project_context: Optional[str] = None
    conversation_context: List[PromptContextItem] = Field(default_factory=list)
    extra_context: List[PromptContextItem] = Field(default_factory=list)
    goal: Optional[str] = None
    audience: Optional[str] = None
    tone: Optional[str] = None
    output_format: Optional[str] = None
    constraints: List[str] = Field(default_factory=list)
    target_models: List[str] = Field(default_factory=list)
    preserve_intent: bool = True
    explanation_style: str = "concise"
    prompt_kind: Optional[str] = None


class OptimizePromptResponse(ContractModel):
    contract_version: str = "2026-04-08"
    request_id: str
    optimized_prompt: str
    title: Optional[str] = None
    summary: Optional[str] = None
    explanation: Optional[str] = None
    prompt_kind: Optional[str] = None
    improvements: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    target_models: List[str] = Field(default_factory=list)
    latency_sec: float = 0.0
    cost_usd: float = 0.0


class EvaluatePromptRequest(ContractModel):
    contract_version: str = "2026-04-08"
    prompt: str
    project_context: Optional[str] = None
    extra_context: List[PromptContextItem] = Field(default_factory=list)
    intended_outcome: Optional[str] = None
    rubric: List[str] = Field(default_factory=list)
    target_models: List[str] = Field(default_factory=list)


class EvaluatePromptResponse(ContractModel):
    contract_version: str = "2026-04-08"
    request_id: str
    overall_score: int = 0
    dimension_scores: Dict[str, int] = Field(default_factory=dict)
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    rewritten_excerpt: Optional[str] = None
    latency_sec: float = 0.0
    cost_usd: float = 0.0
