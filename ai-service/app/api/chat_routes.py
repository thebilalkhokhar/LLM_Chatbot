"""HTTP routes for chat and health endpoints.

This module is intentionally thin: it validates input via Pydantic,
delegates all work to :mod:`app.services.chat_service`, and translates
service-layer errors into HTTP responses.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status

from app.core.config import get_settings
from app.schemas.chat_schema import ChatRequest, ChatResponse
from app.services.chat_service import ChatServiceError, process_chat

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Liveness probe."""
    settings = get_settings()
    return {"status": "ok", "env": settings.app_env}


@router.post(
    "/chat",
    response_model=ChatResponse,
    tags=["chat"],
    summary="Run one chat turn through the LangGraph workflow.",
)
def chat(req: ChatRequest) -> ChatResponse:
    try:
        return process_chat(req)
    except ChatServiceError as exc:
        logger.error("Chat service error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal error while processing the request.",
        ) from exc
