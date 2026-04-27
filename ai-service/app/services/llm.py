"""Multi-provider LLM client.

Supports two chat providers:

* **Groq** — the default. Uses ``llama-3.3-70b-versatile`` via
  :class:`langchain_groq.ChatGroq`.
* **Gemini** — opt-in via ``use_gemini=True``. Uses
  :class:`langchain_google_genai.ChatGoogleGenerativeAI`.

When the preferred provider fails to start (rate limit, auth error,
network blip), the service automatically falls back to the other one.
The :class:`~langchain_core.messages.AIMessage` returned by
:meth:`LLMService.invoke` carries ``response_metadata`` with the
``provider``/``model`` that actually answered, and the streaming API
returns the same metadata up-front so the HTTP layer can advertise
the active engine to the client.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from itertools import chain
from typing import Iterable, Iterator, Sequence

from langchain_core.messages import AIMessage, BaseMessage

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


GROQ = "groq"
GEMINI = "gemini"


class LLMUnavailableError(RuntimeError):
    """Raised when no configured LLM provider can be reached."""


@dataclass
class StreamSession:
    """One streaming run, already past the "first token" probe.

    Attributes
    ----------
    provider:
        Either ``"groq"`` or ``"gemini"`` — the provider that actually
        produced the first chunk.
    model:
        The concrete model id used.
    tokens:
        Iterator yielding string deltas (one chunk = one ``yield``).
    """

    provider: str
    model: str
    tokens: Iterator[str]


class LLMService:
    """Facade that hides provider selection and auto-fallback."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._groq = self._build_groq()
        self._gemini = self._build_gemini()
        if self._groq is None and self._gemini is None:
            raise LLMUnavailableError(
                "No LLM provider configured. Set GROQ_API_KEY (preferred) "
                "and/or GEMINI_API_KEY in ai-service/.env."
            )

    # ------------------------------------------------------------------ #
    # Builders
    # ------------------------------------------------------------------ #
    def _build_groq(self):  # noqa: ANN202
        if not self.settings.groq_api_key:
            logger.warning("GROQ_API_KEY missing — Groq client disabled.")
            return None
        try:
            from langchain_groq import ChatGroq

            return ChatGroq(
                model=self.settings.groq_model,
                groq_api_key=self.settings.groq_api_key,
                temperature=0.3,
                max_retries=1,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to initialize Groq client: %s", exc)
            return None

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
    # Routing helpers
    # ------------------------------------------------------------------ #
    def _client_for(self, provider: str):  # noqa: ANN202
        return self._groq if provider == GROQ else self._gemini

    def _model_for(self, provider: str) -> str:
        if provider == GROQ:
            return self.settings.groq_model
        return self.settings.gemini_model

    @staticmethod
    def _provider_order(use_gemini: bool) -> tuple[str, str]:
        """Preferred provider first, automatic fallback second."""
        return (GEMINI, GROQ) if use_gemini else (GROQ, GEMINI)

    @property
    def available_providers(self) -> list[str]:
        out: list[str] = []
        if self._groq is not None:
            out.append(GROQ)
        if self._gemini is not None:
            out.append(GEMINI)
        return out

    # ------------------------------------------------------------------ #
    # Public API — non-streaming
    # ------------------------------------------------------------------ #
    def invoke(
        self,
        messages: Sequence[BaseMessage],
        *,
        use_gemini: bool = False,
    ) -> AIMessage:
        """Run one synchronous turn through the active provider.

        If the preferred provider raises, we fall back to the other one
        and only re-raise as :class:`LLMUnavailableError` when *both*
        providers fail.
        """
        last_exc: Exception | None = None
        for prov in self._provider_order(use_gemini):
            client = self._client_for(prov)
            if client is None:
                continue
            try:
                logger.debug("Invoking %s (%s).", prov, self._model_for(prov))
                response = client.invoke(list(messages))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Provider %s invoke failed (%s: %s); trying fallback…",
                    prov,
                    exc.__class__.__name__,
                    exc,
                )
                last_exc = exc
                continue

            message = self._to_ai_message(response)
            self._stamp_provider(message, prov, self._model_for(prov))
            logger.info("LLM reply served by %s:%s", prov, self._model_for(prov))
            return message

        raise LLMUnavailableError(
            "All LLM providers failed: "
            f"{(last_exc.__class__.__name__ if last_exc else 'no providers')}: "
            f"{last_exc}"
        ) from last_exc

    # ------------------------------------------------------------------ #
    # Public API — streaming
    # ------------------------------------------------------------------ #
    def start_stream(
        self,
        messages: Sequence[BaseMessage],
        *,
        use_gemini: bool = False,
    ) -> StreamSession:
        """Start streaming, with automatic fallback on first-chunk failure.

        The first chunk is consumed eagerly so that authentication or
        quota errors trigger the fallback *before* the HTTP layer emits
        any ``start`` / ``token`` events. Once we get past the first
        chunk we commit to the active provider; mid-stream errors are
        re-raised to the caller as :class:`LLMUnavailableError`.
        """
        last_exc: Exception | None = None
        for prov in self._provider_order(use_gemini):
            client = self._client_for(prov)
            if client is None:
                continue

            try:
                raw_iter = client.stream(list(messages))
                iterator = iter(raw_iter)
                first_chunk = next(iterator)
            except StopIteration:
                logger.warning("Provider %s stream returned no tokens.", prov)
                last_exc = RuntimeError(f"{prov} produced an empty stream.")
                continue
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Provider %s stream failed to start (%s: %s); trying fallback…",
                    prov,
                    exc.__class__.__name__,
                    exc,
                )
                last_exc = exc
                continue

            tokens = self._yield_tokens(chain([first_chunk], iterator), prov)
            logger.info(
                "LLM streaming via %s:%s", prov, self._model_for(prov)
            )
            return StreamSession(
                provider=prov,
                model=self._model_for(prov),
                tokens=tokens,
            )

        raise LLMUnavailableError(
            "All LLM providers failed to stream: "
            f"{(last_exc.__class__.__name__ if last_exc else 'no providers')}: "
            f"{last_exc}"
        ) from last_exc

    @staticmethod
    def _yield_tokens(stream_iter: Iterable, provider: str) -> Iterator[str]:
        """Convert raw provider chunks into plain text deltas."""
        try:
            for chunk in stream_iter:
                content = getattr(chunk, "content", "")
                if isinstance(content, str) and content:
                    yield content
                elif isinstance(content, list):
                    for part in content:
                        text = (
                            part.get("text") if isinstance(part, dict) else None
                        )
                        if isinstance(text, str) and text:
                            yield text
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Provider %s stream interrupted (%s: %s).",
                provider,
                exc.__class__.__name__,
                exc,
            )
            raise LLMUnavailableError(
                f"{provider} stream interrupted: "
                f"{exc.__class__.__name__}: {exc}"
            ) from exc

    # ------------------------------------------------------------------ #
    # Tool binding
    # ------------------------------------------------------------------ #
    def bind_tools_to(self, tools, *, use_gemini: bool = False):  # noqa: ANN001, ANN201
        """Return a tool-bound copy of the active client.

        Currently used by callers that want LangChain tool-calling
        semantics (e.g. a future ``rag_tool`` agent loop). The retriever
        node in this codebase injects RAG context directly into the
        prompt, so tool binding is optional today — but exposing it here
        keeps the door open without leaking provider details.
        """
        prov = GEMINI if use_gemini else GROQ
        client = self._client_for(prov) or self._client_for(
            GROQ if use_gemini else GEMINI
        )
        if client is None:
            raise LLMUnavailableError("No provider available to bind tools to.")
        return client.bind_tools(list(tools))

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _to_ai_message(response: BaseMessage | AIMessage) -> AIMessage:
        if isinstance(response, AIMessage):
            return response
        return AIMessage(content=getattr(response, "content", str(response)))

    @staticmethod
    def _stamp_provider(message: AIMessage, provider: str, model: str) -> None:
        metadata = dict(message.response_metadata or {})
        metadata["provider"] = provider
        metadata["model"] = model
        message.response_metadata = metadata


@lru_cache(maxsize=1)
def get_llm_service() -> LLMService:
    """Cached singleton accessor used by graph nodes and FastAPI."""
    return LLMService()
