import json
import os
import time
import logging
from pydantic import BaseModel
from typing import List, Optional, Any
from google import genai
from google.genai import types
from dotenv import load_dotenv

from .prompt import SYSTEM_PROMPT, build_compact_user_message
from .user_data import get_user_data

load_dotenv()

# --- Logging Setup ---
logger = logging.getLogger("agent_tracing")
logger.setLevel(logging.INFO)
if not logger.handlers:
    fh = logging.FileHandler("tracing.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter('\n[%(asctime)s] TRACE\n%(message)s'))
    logger.addHandler(fh)
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter('\n[TRACE] %(message)s'))
    logger.addHandler(ch)

client = genai.Client()
model_name = os.getenv("DEFAULT_MODEL", "gemini-2.0-flash")

PRICE_PER_1M_PROMPT = 0.075
PRICE_PER_1M_CANDIDATE = 0.30


class FormField(BaseModel):
    id: str
    name: Optional[str] = None
    placeholder: Optional[str] = None
    type: Optional[str] = None
    label: Optional[str] = None


class FieldMappingResult(BaseModel):
    field_id: str
    value: Any


class AnalyzeResponse(BaseModel):
    mappings: List[FieldMappingResult]
    latency_sec: float = 0.0
    cost_usd: float = 0.0


async def analyze_form_fields(fields: List[FormField], document_chunks: List[str] = None) -> AnalyzeResponse:
    """
    Token-optimized agent:
    - SYSTEM PROMPT: static, short (no docs, no user data)
    - USER MESSAGE: compact JSON (null-stripped profile + fields + top-3 trimmed doc chunks)
    """
    user_data = get_user_data()
    fields_dict = [f.model_dump() for f in fields]
    doc_chunks = document_chunks or []

    # Build compact user message — all optimization happens here
    user_message = build_compact_user_message(user_data, fields_dict, doc_chunks)

    start_time = time.time()
    try:
        response = await client.aio.models.generate_content(
            model=model_name,
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                temperature=0.0
            )
        )

        latency = round(time.time() - start_time, 2)
        prompt_tokens = response.usage_metadata.prompt_token_count if response.usage_metadata else 0
        output_tokens = response.usage_metadata.candidates_token_count if response.usage_metadata else 0
        cost = (prompt_tokens / 1_000_000) * PRICE_PER_1M_PROMPT + (output_tokens / 1_000_000) * PRICE_PER_1M_CANDIDATE

        logger.info(
            f"Model:{model_name} | Latency:{latency}s | "
            f"Tokens:{prompt_tokens}in/{output_tokens}out | Cost:${cost:.6f} | "
            f"DocChunks:{len(doc_chunks)}\n"
            f"MSG_CHARS:{len(user_message)} | RESPONSE:{response.text}"
        )

        result_dict = json.loads(response.text)
        return AnalyzeResponse(
            mappings=result_dict.get("mappings", []),
            latency_sec=latency,
            cost_usd=cost
        )

    except Exception as e:
        latency = round(time.time() - start_time, 2)
        logger.error(f"FAILURE [{latency}s]: {e}")
        return AnalyzeResponse(mappings=[FieldMappingResult(field_id=f.id, value=None) for f in fields])
