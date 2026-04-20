"""LLM client wrapper (Gemini-only for now).

Exposes a single :class:`LLMService` that calls Google Gemini.

A HuggingFace fallback used to live here and may be reintroduced in a
future phase. For now this wrapper only talks to Gemini, which keeps the
code path simple and avoids the HF / Inference API maintenance burden.

The returned :class:`~langchain_core.messages.AIMessage` carries
``response_metadata`` with ``provider`` and ``model`` so callers can
surface which backend answered.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Iterator, Sequence

from langchain_core.messages import AIMessage, BaseMessage

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


class LLMUnavailableError(RuntimeError):
    """Raised when the configured LLM provider cannot be reached."""


class LLMService:
    """Thin facade over Google Gemini."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._client = self._build_gemini()

        if self._client is None:
            raise LLMUnavailableError(
                "No LLM provider configured. Set GEMINI_API_KEY in your .env."
            )

    # ------------------------------------------------------------------ #
    # Provider builder
    # ------------------------------------------------------------------ #
    def _build_gemini(self):  # noqa: ANN202
        if not self.settings.gemini_api_key:
            logger.warning("GEMINI_API_KEY missing — Gemini client disabled.")
            return None
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI

            return ChatGoogleGenerativeAI(
                model=self.settings.gemini_model,
                google_api_key=self.settings.gemini_api_key,
                temperature=0.3,
                max_retries=1,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to initialize Gemini client: %s", exc)
            return None

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def invoke(self, messages: Sequence[BaseMessage]) -> AIMessage:
        """Call Gemini and return an :class:`AIMessage` with provider metadata."""
        if self._client is None:
            raise LLMUnavailableError("Gemini client is not initialized.")

        try:
            logger.debug("Invoking Gemini (%s).", self.settings.gemini_model)
            response = self._client.invoke(list(messages))
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Gemini call failed (%s: %s).", exc.__class__.__name__, exc
            )
            raise LLMUnavailableError(
                f"Gemini call failed: {exc.__class__.__name__}: {exc}"
            ) from exc

        message = self._to_ai_message(response)
        self._stamp_provider(message, "gemini", self.settings.gemini_model)
        logger.info("LLM reply served by gemini:%s", self.settings.gemini_model)
        return message

    def stream(self, messages: Sequence[BaseMessage]) -> Iterator[str]:
        """Stream Gemini's reply token-by-token.

        Yields plain string chunks (the ``content`` of each
        :class:`~langchain_core.messages.AIMessageChunk`). Raises
        :class:`LLMUnavailableError` if the underlying client is not
        initialized or the upstream call fails before any token is
        emitted. If the stream fails *mid-flight*, the error is logged
        and the generator simply stops — the consumer is responsible
        for emitting a suitable "error" terminator in that case.
        """
        if self._client is None:
            raise LLMUnavailableError("Gemini client is not initialized.")

        logger.debug("Streaming Gemini (%s).", self.settings.gemini_model)
        try:
            stream_iter = self._client.stream(list(messages))
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Gemini stream start failed (%s: %s).",
                exc.__class__.__name__,
                exc,
            )
            raise LLMUnavailableError(
                f"Gemini stream failed to start: {exc.__class__.__name__}: {exc}"
            ) from exc

        try:
            for chunk in stream_iter:
                content = getattr(chunk, "content", "")
                if isinstance(content, str) and content:
                    yield content
                elif isinstance(content, list):
                    # Some providers return list-of-parts; flatten text parts.
                    for part in content:
                        text = (
                            part.get("text") if isinstance(part, dict) else None
                        )
                        if isinstance(text, str) and text:
                            yield text
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Gemini stream interrupted (%s: %s).",
                exc.__class__.__name__,
                exc,
            )
            raise LLMUnavailableError(
                f"Gemini stream interrupted: {exc.__class__.__name__}: {exc}"
            ) from exc

        logger.info(
            "LLM streamed reply served by gemini:%s", self.settings.gemini_model
        )

    @staticmethod
    def _to_ai_message(response: BaseMessage | AIMessage) -> AIMessage:
        if isinstance(response, AIMessage):
            return response
        return AIMessage(content=getattr(response, "content", str(response)))

    @staticmethod
    def _stamp_provider(message: AIMessage, provider: str, model: str) -> None:
        """Attach provider/model info to an :class:`AIMessage`'s metadata."""
        metadata = dict(message.response_metadata or {})
        metadata["provider"] = provider
        metadata["model"] = model
        message.response_metadata = metadata


@lru_cache(maxsize=1)
def get_llm_service() -> LLMService:
    """Cached singleton accessor used by graph nodes and FastAPI."""
    return LLMService()
