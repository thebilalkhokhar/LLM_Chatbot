"""FastAPI application entry point.

Responsibilities are deliberately minimal:
    * build the :class:`FastAPI` application instance,
    * trigger configuration / logging bootstrap via :func:`get_settings`,
    * register API routers.

All business logic lives in ``app.services`` and ``app.graph``.
"""

from __future__ import annotations

from fastapi import FastAPI

from app.api import chat_router, upload_router
from app.core.config import get_settings


def create_app() -> FastAPI:
    """Application factory."""
    settings = get_settings()

    app = FastAPI(
        title="AI Service",
        version="0.2.0",
        description=(
            "LangGraph-powered LLM service using Google Gemini, with a "
            "PDF-based RAG pipeline (FAISS + Google embeddings)."
        ),
        debug=settings.app_env == "development",
    )

    app.include_router(chat_router)
    app.include_router(upload_router)

    return app


app = create_app()
