"""Thin OpenAI client helpers for sales AI features."""
from __future__ import annotations

from fastapi import HTTPException

from app.core.config import get_settings


def require_openai_client():
    """Return an OpenAI client or raise 503 if not configured."""
    settings = get_settings()
    key = (settings.openai_api_key or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="AI not configured (missing OPENAI_API_KEY)")
    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover
        raise HTTPException(status_code=503, detail="OpenAI package not installed") from exc
    return OpenAI(api_key=key), settings.openai_model or "gpt-4o-mini"


def openai_configured() -> bool:
    return bool((get_settings().openai_api_key or "").strip())
