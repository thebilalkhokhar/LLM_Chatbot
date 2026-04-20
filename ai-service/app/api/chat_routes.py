"""HTTP routes for chat and health endpoints.

This module is intentionally thin: it validates input via Pydantic,
delegates all work to :mod:`app.services.chat_service`, and translates
service-layer errors into HTTP responses.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from app.core.config import get_settings
from app.schemas.chat_schema import ChatRequest, ChatResponse
from app.services.chat_service import ChatServiceError, process_chat, stream_chat

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


@router.post(
    "/chat/stream",
    tags=["chat"],
    summary="Run one chat turn and stream Gemini tokens as NDJSON.",
    responses={
        200: {
            "description": (
                "Newline-delimited JSON stream. One JSON object per line. "
                "Event types: `start`, `token`, `done`, `error`."
            ),
            "content": {"application/x-ndjson": {}},
        }
    },
)
def chat_stream(req: ChatRequest) -> StreamingResponse:
    """Stream the assistant reply token-by-token.

    The response body is ``application/x-ndjson`` (newline-delimited
    JSON). Each line is a standalone JSON object — the Node gateway
    parses these lines and re-emits them to the browser as SSE events.
    """
    return StreamingResponse(
        stream_chat(req),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
