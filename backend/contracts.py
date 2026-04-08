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
    domain: Optional[str] = None
    page_type: Optional[str] = None
    field_label: Optional[str] = None
    field_type: Optional[str] = None
    field_name: Optional[str] = None
    field_id: Optional[str] = None
    field_intent: Optional[str] = None
    value: Any = None
    confidence: int = 0
    value_source: Optional[str] = None
    usage_count: int = 0
    correction_count: int = 0


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
