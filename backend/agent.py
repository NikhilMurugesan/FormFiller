import json
import os
import re
import time
import asyncio
from pydantic import BaseModel
from typing import List, Optional, Any
from google import genai
from google.genai import types
from dotenv import load_dotenv

from .prompt import SYSTEM_PROMPT, build_compact_user_message
from .user_data import get_user_data

load_dotenv()

import sys as _sys

# --- Tracer: always prints to terminal and appends to tracing.log ---
_LOG_FILE = "tracing.log"

def _trace(msg: str, level: str = "INFO"):
    """Write a trace line to stdout (always visible in uvicorn) and tracing.log."""
    line = f"\n[BACKEND {level}] {msg}"
    # stdout — guaranteed to appear in the uvicorn terminal
    print(line, flush=True, file=_sys.stdout)
    # file — persistent trace log
    try:
        with open(_LOG_FILE, "a", encoding="utf-8") as f:
            import datetime
            f.write(f"\n[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {level}\n{msg}\n")
    except Exception:
        pass

client = genai.Client()
model_name = os.getenv("DEFAULT_MODEL", "gemini-3-flash-preview")

PRICE_PER_1M_PROMPT = 0.075
PRICE_PER_1M_CANDIDATE = 0.30
MAX_RETRIES = 2


def extract_retry_delay(error_str: str, default: int = 35) -> int:
    """Parse the retryDelay value (seconds) from a Gemini 429 error."""
    match = re.search(r"retryDelay.*?(\d+)s", error_str)
    return int(match.group(1)) + 2 if match else default  # +2s safety buffer


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
    last_error = None

    for attempt in range(MAX_RETRIES + 1):
        try:
            print(f"\n[API HIT] Calling Gemini LLM (generate_content) | Model: {model_name} | Attempt: {attempt + 1}", flush=True)
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

            _trace(
                f"Model:{model_name} | Latency:{latency}s | "
                f"Tokens:{prompt_tokens}in/{output_tokens}out | Cost:${cost:.6f} | "
                f"DocChunks:{len(doc_chunks)} | MSG_CHARS:{len(user_message)}\n"
                f"RESPONSE: {response.text}"
            )

            result_dict = json.loads(response.text)
            return AnalyzeResponse(
                mappings=result_dict.get("mappings", []),
                latency_sec=latency,
                cost_usd=cost
            )

        except Exception as e:
            last_error = e
            error_str = str(e)
            if "429" in error_str and attempt < MAX_RETRIES:
                wait = extract_retry_delay(error_str)
                _trace(f"Rate limited (attempt {attempt + 1}/{MAX_RETRIES}). Waiting {wait}s before retry...", "WARNING")
                await asyncio.sleep(wait)
            else:
                break  # non-rate-limit error or retries exhausted

    latency = round(time.time() - start_time, 2)
    _trace(f"FAILURE [{latency}s]: {last_error}", "ERROR")
    return AnalyzeResponse(mappings=[FieldMappingResult(field_id=f.id, value=None) for f in fields])
